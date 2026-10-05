'use client'

import {
  Campaign,
  CampaignDocumentAdapterError,
  Chat,
  Notebook,
  VisualizationDashboard,
  classifyCampaignDocument,
} from '@ihub/ui'
import { createEmptyDocument } from '@ihub/utils/helpers/create'
import { Alert, Box, Button, Group, LoadingOverlay, Text } from '@mantine/core'
import { useRouter, useSearchParams } from 'next/navigation.js'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import {
  activeTabAtom,
  jupyterServersAtom,
  renameProjectFileTabsAtom,
  setTabCampaignSheetAtom,
  setTabCampaignViewportAtom,
} from '@/atoms/global.js'
import {
  activeProjectFileEditorAtom,
  activeProjectFileNavigationEditorAtom,
} from '@/atoms/project-file-editor.ts'
import { CampaignModel } from '@ihub/utils/types/campaign'
import { ChatData } from '@ihub/utils/types/chat'
import {
  JupyterNotebookFile,
  JupyterServerConfig,
} from '@ihub/utils/types/notebook'
import { UserProfile } from '@ihub/utils/types/types'
import { VisualizationFileContent } from '@ihub/utils/types/visualization'
import { useSession } from '@/app/providers/SessionProvider.tsx'
import { bootstrapProjectFile } from '../../project-file-bootstrap.ts'
import {
  buildProjectFileCoordinationKey,
  createBrowserProjectFileCoordinator,
  normalizeProjectFileContentPath,
  normalizeProjectFileServerIdentity,
  ProjectFileSharedLockController,
} from '../../project-file-coordination.ts'
import {
  buildProjectFileRoute,
  encodePathSegments,
} from '../../project-file-path.ts'
import { tabMatchesProjectFile } from '@/hooks/tab-state.ts'
import {
  applyDocumentContentUpdate,
  assertSuccessfulSaveResponse,
  buildDocumentKey,
  flushDocumentSaveBarrier,
  getActiveLoadedDocument,
  getDocumentSaveFailureMessage,
  getNormalizedFileExtension,
  markDocumentCleanAfterSave,
  normalizeJsonFileContent,
  normalizeHttpBaseUrl,
  normalizeTextFileContent,
  ownsLatestSaveCompletion,
  parseLoadedDocumentContent,
  preserveDirtyAfterFailedSave,
  savedLatestDocumentSnapshot,
  shouldAutosaveDocument,
  shouldAttemptAutomaticSave,
  type AutosaveFailure,
  type DocumentContentUpdateOptions,
  type DocumentSaveAttempt,
  type EditorDocument,
  type LoadedDocument,
  type LoadError,
} from '../../document-state.js'

interface ClientPageProps {
  project_id: string
  file_path: string
}

const navigationBlockedByDocumentActivity = Symbol(
  'navigation-blocked-by-document-activity',
)

/**
 * Returns whether a file format should remain raw string content in-memory.
 */
function shouldPreserveStringContent(fileFormat: string): boolean {
  return fileFormat === 'txt' || fileFormat === 'json'
}

/**
 * Displays plain-text content in a scrollable, preformatted viewer.
 */
function TextFileViewer({ content }: { content: string }) {
  return (
    <div
      style={{
        height: '100%',
        width: '100%',
        overflow: 'auto',
        padding: '1rem',
      }}
    >
      <pre
        style={{
          margin: 0,
          minHeight: '100%',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          fontFamily:
            'var(--mantine-font-family-monospace, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)',
          fontSize: '0.875rem',
          lineHeight: 1.5,
        }}
      >
        {content}
      </pre>
    </div>
  )
}

/**
 * Reads response text safely, returning an empty string when unreadable.
 */
async function readResponseText(response: Response): Promise<string> {
  try {
    return await response.text()
  } catch {
    return ''
  }
}

/**
 * Normalizes unknown errors to a readable string for logs and UI messages.
 */
function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === 'string') {
    return error
  }

  try {
    return JSON.stringify(error, (_key, value) => {
      if (value instanceof Set) {
        return [...value]
      }
      if (value instanceof Map) {
        return Object.fromEntries(value)
      }
      return value
    })
  } catch {
    return String(error)
  }
}

/**
 * Persists an editor document to Jupyter contents API at the provided path.
 */
async function saveDocument(
  path: string,
  content: EditorDocument,
  jupyter_url: string,
  jupyter_token: string,
) {
  const requestContent =
    content.type === 'notebook'
      ? content.content
      : JSON.stringify(content.content)

  const response = await fetch(
    `${jupyter_url}/api/contents/${encodePathSegments(path)}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${jupyter_token}`,
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
      body: JSON.stringify({
        ...content,
        content: requestContent,
      }),
    },
  )

  await assertSuccessfulSaveResponse(response)
}

/**
 * Renders and manages project file editing, loading, and autosave behavior.
 */
export default function ClientPage({ project_id, file_path }: ClientPageProps) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const createMode = searchParams.get('create') === '1'
  const jupyterServers = useAtomValue<JupyterServerConfig[]>(jupyterServersAtom)
  const activeTab = useAtomValue(activeTabAtom)
  const setTabCampaignSheet = useSetAtom(setTabCampaignSheetAtom)
  const setTabCampaignViewport = useSetAtom(setTabCampaignViewportAtom)
  const { session: session } = useSession()

  const decodedFilePath = normalizeProjectFileContentPath(file_path)

  // assume the first jupyter server for now
  const jupyterServer = jupyterServers?.[0]
  const jupyterServerIdentity = jupyterServer
    ? normalizeProjectFileServerIdentity(jupyterServer.url)
    : null
  const jupyterServerBaseUrl = normalizeHttpBaseUrl(jupyterServer?.url)
  const projectRootPath = `projects/${project_id}`
  const requestedContentPath = `${projectRootPath}/${decodedFilePath}`
  const projectFileCoordinator = useMemo(
    () => createBrowserProjectFileCoordinator(),
    [],
  )
  const pathResolutionKey = `${jupyterServerIdentity ?? ''}\0${project_id}\0${requestedContentPath}`
  const [pathResolution, setPathResolution] = useState<{
    key: string
    contentPath: string
  } | null>(null)
  const contentPath =
    pathResolution?.key === pathResolutionKey
      ? pathResolution.contentPath
      : requestedContentPath
  const resolvedFilePath = contentPath.startsWith(`${projectRootPath}/`)
    ? contentPath.slice(projectRootPath.length + 1)
    : decodedFilePath
  const routeNeedsRetarget = contentPath !== requestedContentPath
  const fileFormat: string = getNormalizedFileExtension(resolvedFilePath)
  const documentKey = buildDocumentKey({
    projectId: project_id,
    filePath: resolvedFilePath,
    jupyterServer,
    jupyterServerBaseUrl,
  })
  const coordinationKey =
    jupyterServer && projectFileCoordinator.supported
      ? buildProjectFileCoordinationKey(
          jupyterServer.url,
          project_id,
          contentPath,
        )
      : null
  const sharedLockController = useMemo(
    () =>
      coordinationKey
        ? new ProjectFileSharedLockController(
            projectFileCoordinator,
            coordinationKey,
          )
        : null,
    [coordinationKey, projectFileCoordinator],
  )

  const [loadedDocument, setLoadedDocument] = useState<LoadedDocument>()
  const [loadError, setLoadError] = useState<LoadError | null>(null)
  const [renameLocked, setRenameLocked] = useState(false)
  const [sharedLockReady, setSharedLockReady] = useState(false)
  const [sharedLockError, setSharedLockError] = useState<Error | null>(null)
  const [autosaveFailure, setAutosaveFailure] =
    useState<AutosaveFailure | null>(null)
  const [savePending, setSavePending] = useState(false)
  const loadedDocumentRef = useRef<LoadedDocument | undefined>(undefined)
  const inFlightSaveRef = useRef<Promise<void> | null>(null)
  const nextSaveAttemptIdRef = useRef(0)
  const latestSaveAttemptIdRef = useRef(0)
  const renameLockRef = useRef(false)
  const documentActivityRef = useRef(false)
  const documentKeyRef = useRef(documentKey)
  documentKeyRef.current = documentKey
  const pathResolutionKeyRef = useRef(pathResolutionKey)
  pathResolutionKeyRef.current = pathResolutionKey
  const setActiveProjectFileEditor = useSetAtom(activeProjectFileEditorAtom)
  const setActiveProjectFileNavigationEditor = useSetAtom(
    activeProjectFileNavigationEditorAtom,
  )
  const renameProjectFileTabs = useSetAtom(renameProjectFileTabsAtom)
  const activeLoadedDocument = getActiveLoadedDocument(
    loadedDocument,
    documentKey,
  )
  const activeLoadError =
    loadError?.key === documentKey ? loadError.message : null
  const campaignTab = tabMatchesProjectFile(activeTab, project_id, contentPath)
    ? activeTab
    : null
  const handleCampaignSheetChange = useCallback(
    (sheetId: string) => {
      if (campaignTab) {
        setTabCampaignSheet(campaignTab.id, sheetId)
      }
    },
    [campaignTab, setTabCampaignSheet],
  )
  const handleCampaignViewportChange = useCallback(
    (sheetId: string, viewport: { x: number; y: number; zoom: number }) => {
      if (campaignTab) {
        setTabCampaignViewport(campaignTab.id, sheetId, viewport)
      }
    },
    [campaignTab, setTabCampaignViewport],
  )

  /**
   * Commits loaded-document state to both ref and React state atomically.
   */
  const commitLoadedDocument = useCallback(
    (nextDocument: LoadedDocument | undefined) => {
      loadedDocumentRef.current = nextDocument
      setLoadedDocument(nextDocument)
    },
    [],
  )

  /**
   * Stores a newly loaded document snapshot for a specific document key.
   */
  const setLoadedDocumentForKey = useCallback(
    (key: string, nextDocument: EditorDocument) => {
      commitLoadedDocument({
        key,
        document: nextDocument,
        dirty: false,
      })
    },
    [commitLoadedDocument],
  )

  /** Applies editor content changes, including final background-work updates. */
  const updateDocumentContent = useCallback(
    (content: unknown, options: DocumentContentUpdateOptions = {}) => {
      commitLoadedDocument(
        applyDocumentContentUpdate(
          loadedDocumentRef.current,
          documentKey,
          content,
          options,
        ),
      )
    },
    [commitLoadedDocument, documentKey],
  )

  /** Tracks background work reported by the mounted document editor. */
  const handleDocumentActivityChange = useCallback((active: boolean) => {
    documentActivityRef.current = active
  }, [])

  /**
   * Saves a stable document snapshot and keeps dirty state accurate on failure.
   */
  const saveDocumentSnapshot = useCallback(
    async (documentToSave: LoadedDocument) => {
      if (!jupyterServer || !jupyterServerBaseUrl) {
        throw new Error('Jupyter server is unavailable.')
      }

      const attempt: DocumentSaveAttempt = {
        id: nextSaveAttemptIdRef.current + 1,
        key: documentToSave.key,
        document: documentToSave.document,
      }
      nextSaveAttemptIdRef.current = attempt.id
      latestSaveAttemptIdRef.current = attempt.id
      setSavePending(true)

      const previousSave = inFlightSaveRef.current
      const saveOperation = (async () => {
        if (previousSave) {
          try {
            await previousSave
          } catch {
            // A newer snapshot still needs its own save attempt.
          }
        }

        const currentContentPath = projectFileCoordinator.resolveContentPath(
          jupyterServer.url,
          project_id,
          contentPath,
        )
        await saveDocument(
          currentContentPath,
          documentToSave.document,
          jupyterServerBaseUrl,
          jupyterServer.token,
        )
        commitLoadedDocument(
          markDocumentCleanAfterSave(loadedDocumentRef.current, documentToSave),
        )
        if (
          savedLatestDocumentSnapshot({
            attempt,
            latestAttemptId: latestSaveAttemptIdRef.current,
            currentDocument: loadedDocumentRef.current,
          })
        ) {
          setAutosaveFailure(null)
        }
      })()

      inFlightSaveRef.current = saveOperation
      try {
        await saveOperation
      } catch (error) {
        commitLoadedDocument(
          preserveDirtyAfterFailedSave(
            loadedDocumentRef.current,
            documentToSave,
          ),
        )
        if (
          ownsLatestSaveCompletion({
            attempt,
            latestAttemptId: latestSaveAttemptIdRef.current,
            currentDocumentKey: documentKeyRef.current,
          })
        ) {
          setAutosaveFailure({
            key: attempt.key,
            document: attempt.document,
            message: getDocumentSaveFailureMessage(error),
          })
        }
        throw error
      } finally {
        if (inFlightSaveRef.current === saveOperation) {
          inFlightSaveRef.current = null
        }
        if (latestSaveAttemptIdRef.current === attempt.id) {
          setSavePending(false)
        }
      }
    },
    [
      commitLoadedDocument,
      contentPath,
      jupyterServer,
      jupyterServerBaseUrl,
      projectFileCoordinator,
      project_id,
    ],
  )

  /**
   * Releases rename lock state after rename completion or cancellation.
   */
  const releaseRenameLock = useCallback(() => {
    renameLockRef.current = false
    setRenameLocked(false)
  }, [])

  /** Commits focused drafts and saves every dirty document snapshot. */
  const prepareDocumentSaveBarrier = useCallback(
    async (
      keepLocked: boolean,
      requireLoadedDocument: boolean,
      rejectDocumentActivity = false,
    ): Promise<boolean> => {
      if (rejectDocumentActivity && documentActivityRef.current) {
        return false
      }

      if (
        !documentKey ||
        !getActiveLoadedDocument(loadedDocumentRef.current, documentKey)
      ) {
        if (!requireLoadedDocument) {
          return true
        }
        throw new Error('The open document is not ready to be saved.')
      }

      renameLockRef.current = true
      setRenameLocked(true)
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur()
      }

      try {
        await new Promise<void>((resolve) => {
          window.requestAnimationFrame(() => resolve())
        })

        if (rejectDocumentActivity && documentActivityRef.current) {
          throw navigationBlockedByDocumentActivity
        }

        if (
          requireLoadedDocument &&
          !getActiveLoadedDocument(loadedDocumentRef.current, documentKey)
        ) {
          throw new Error('The open document is not ready to be saved.')
        }

        await flushDocumentSaveBarrier({
          currentDocumentKey: documentKey,
          getLatestDocument: () => loadedDocumentRef.current,
          getInFlightSave: () => inFlightSaveRef.current,
          saveDocument: async (documentToSave) => {
            if (rejectDocumentActivity && documentActivityRef.current) {
              throw navigationBlockedByDocumentActivity
            }
            await saveDocumentSnapshot(documentToSave)
          },
        })
      } catch (error) {
        releaseRenameLock()
        if (error === navigationBlockedByDocumentActivity) {
          return false
        }
        throw error
      }

      if (rejectDocumentActivity && documentActivityRef.current) {
        releaseRenameLock()
        return false
      }

      if (!keepLocked) {
        releaseRenameLock()
      }
      return true
    },
    [documentKey, releaseRenameLock, saveDocumentSnapshot],
  )

  /** Flushes focused input drafts before application-controlled navigation. */
  const prepareNavigation = useCallback(
    () => prepareDocumentSaveBarrier(false, false, true),
    [prepareDocumentSaveBarrier],
  )

  /**
   * Prepares the active file for rename by flushing pending edits first.
   */
  const prepareRename = useCallback(async () => {
    if (
      !documentKey ||
      !getActiveLoadedDocument(loadedDocumentRef.current, documentKey)
    ) {
      throw new Error('The open document is not ready to be renamed.')
    }

    if (documentActivityRef.current) {
      return false
    }

    await prepareDocumentSaveBarrier(true, true)
    return true
  }, [documentKey, prepareDocumentSaveBarrier])

  /** Hold a shared source-path lock for the lifetime of the mounted editor. */
  useEffect(() => {
    if (!sharedLockController || routeNeedsRetarget) {
      return
    }

    let cancelled = false
    setSharedLockReady(false)
    setSharedLockError(null)
    void sharedLockController
      .acquire()
      .then(() => {
        if (!cancelled) {
          setSharedLockReady(true)
        }
      })
      .catch((error: unknown) => {
        console.error('Failed to acquire the project-file editor lock', {
          path: contentPath,
          error,
        })
        if (!cancelled) {
          setSharedLockError(
            error instanceof Error
              ? error
              : new Error('Unable to coordinate project-file editing.'),
          )
        }
      })

    return () => {
      cancelled = true
      void sharedLockController.release()
    }
  }, [contentPath, routeNeedsRetarget, sharedLockController])

  /** Registers save preparation independently from rename coordination. */
  useEffect(() => {
    if (!documentKey || routeNeedsRetarget) {
      return
    }

    const navigationEditor = { prepareNavigation }
    setActiveProjectFileNavigationEditor(navigationEditor)

    return () => {
      setActiveProjectFileNavigationEditor((currentEditor) =>
        currentEditor === navigationEditor ? null : currentEditor,
      )
    }
  }, [
    documentKey,
    prepareNavigation,
    routeNeedsRetarget,
    setActiveProjectFileNavigationEditor,
  ])

  /**
   * Registers this editor for cross-component rename flow when coordination is ready.
   */
  useEffect(() => {
    if (
      !documentKey ||
      !jupyterServerIdentity ||
      !sharedLockController ||
      !sharedLockReady ||
      routeNeedsRetarget
    ) {
      return
    }

    const registrationId = Symbol('project-file-editor')
    setActiveProjectFileEditor({
      registrationId,
      serverIdentity: jupyterServerIdentity,
      projectId: project_id,
      contentPath,
      isBusy: () => documentActivityRef.current,
      prepareRename,
      pauseSharedLock: () => sharedLockController.release(),
      resumeSharedLock: () => sharedLockController.acquire(),
      releaseRename: releaseRenameLock,
    })

    return () => {
      setActiveProjectFileEditor((currentEditor) =>
        currentEditor?.registrationId === registrationId ? null : currentEditor,
      )
    }
  }, [
    contentPath,
    documentKey,
    jupyterServerIdentity,
    prepareRename,
    project_id,
    releaseRenameLock,
    routeNeedsRetarget,
    setActiveProjectFileEditor,
    sharedLockReady,
    sharedLockController,
  ])

  /**
   * Clears any stale rename lock whenever the active document key changes.
   */
  useEffect(() => {
    documentActivityRef.current = false
    setAutosaveFailure(null)
    setSavePending(false)
    releaseRenameLock()
  }, [documentKey, releaseRenameLock])

  /** Retarget a delayed route before it can read or recreate a renamed path. */
  useEffect(() => {
    if (!routeNeedsRetarget) {
      return
    }

    renameProjectFileTabs(
      project_id,
      requestedContentPath,
      contentPath,
      contentPath.split('/').at(-1) ?? resolvedFilePath,
    )
    router.replace(buildProjectFileRoute(project_id, resolvedFilePath))
  }, [
    contentPath,
    project_id,
    renameProjectFileTabs,
    requestedContentPath,
    resolvedFilePath,
    routeNeedsRetarget,
    router,
  ])

  /**
   * Loads or creates the active project file from Jupyter when context changes.
   */
  useEffect(() => {
    if (
      routeNeedsRetarget ||
      (sharedLockController !== null && !sharedLockReady) ||
      !jupyterServer ||
      !jupyterServerBaseUrl ||
      !documentKey
    ) {
      return
    }

    const currentDocumentKey = documentKey
    let isCurrentLoad = true

    const readFileContent = async () => {
      try {
        setLoadError(null)

        const applyLoadedDocument = (nextDocument: EditorDocument) => {
          if (isCurrentLoad) {
            setLoadedDocumentForKey(currentDocumentKey, nextDocument)
          }
        }

        const createMissingFile = async (): Promise<EditorDocument> => {
          for (const dirPath of ['projects', `projects/${project_id}`]) {
            const dirRes = await fetch(
              `${jupyterServerBaseUrl}/api/contents/${dirPath}`,
              {
                method: 'PUT',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${jupyterServer.token}`,
                },
                body: JSON.stringify({ type: 'directory' }),
              },
            )
            if (!dirRes.ok && dirRes.status !== 409) {
              const text = await readResponseText(dirRes)
              throw new Error(
                `Error creating directory ${dirPath}: ${dirRes.status} ${text}`,
              )
            }
          }

          const empty_document = createEmptyDocument(
            resolvedFilePath,
            fileFormat,
          )

          if (empty_document === undefined) {
            throw new Error(
              'Cannot create an empty document for this file format.',
            )
          }

          const createFileResponse = await fetch(
            `${jupyterServerBaseUrl}/api/contents/${encodePathSegments(requestedContentPath)}`,
            {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache',
                Pragma: 'no-cache',
                Authorization: `Bearer ${jupyterServer.token}`,
              },
              body: JSON.stringify({
                ...empty_document,
                content:
                  empty_document?.type === 'notebook'
                    ? empty_document?.content
                    : JSON.stringify(empty_document?.content),
              }),
            },
          )

          if (createFileResponse.ok) {
            return empty_document
          }

          if (createFileResponse.status === 409) {
            throw new Error(
              'A document with this name was created elsewhere. ' +
                'Return to the launcher and try again.',
            )
          }

          const text = await readResponseText(createFileResponse)
          throw new Error(
            `Error creating file: ${createFileResponse.status} ${text}`,
          )
        }

        const result = await bootstrapProjectFile({
          requestedContentPath,
          createMode,
          readRequestedFile: async () => {
            const readResponse = await fetch(
              `${jupyterServerBaseUrl}/api/contents/${encodePathSegments(requestedContentPath)}`,
              {
                method: 'GET',
                headers: {
                  'Content-Type': 'application/json',
                  'Cache-Control': 'no-cache',
                  Pragma: 'no-cache',
                  Authorization: `Bearer ${jupyterServer.token}`,
                },
              },
            )

            if (readResponse.ok) {
              const d = (await readResponse.json()) as EditorDocument
              return {
                status: 'found' as const,
                document: parseLoadedDocumentContent(d, {
                  preserveStringContent:
                    shouldPreserveStringContent(fileFormat),
                }),
              }
            }

            if (readResponse.status === 401 || readResponse.status === 403) {
              throw new Error(
                'Jupyter session authorization failed while loading this file.',
              )
            }

            if (readResponse.status !== 404) {
              const readText = await readResponseText(readResponse)
              throw new Error(
                `Failed to load file: ${readResponse.status} ${readText}`,
              )
            }

            return { status: 'missing' as const }
          },
          createRequestedFile: createMissingFile,
          resolveContentPath: () =>
            projectFileCoordinator.resolveContentPath(
              jupyterServer.url,
              project_id,
              requestedContentPath,
            ),
          invalidateRenameMapping: () =>
            projectFileCoordinator.invalidateRenameMapping(
              jupyterServer.url,
              project_id,
              requestedContentPath,
            ),
          isCurrent: () =>
            isCurrentLoad && pathResolutionKeyRef.current === pathResolutionKey,
        })

        if (result.status === 'superseded') {
          return
        }

        if (result.status === 'retarget') {
          setPathResolution({
            key: pathResolutionKey,
            contentPath: result.contentPath,
          })
          return
        }

        if (result.status === 'missing') {
          commitLoadedDocument(undefined)
          setLoadError({
            key: currentDocumentKey,
            message: 'File not found. Reopen the file from project navigation.',
          })
          return
        }

        if (!result.mappingRemovalSucceeded) {
          console.error(
            'Failed to remove a stale project-file rename mapping',
            {
              path: requestedContentPath,
            },
          )
        }
        applyLoadedDocument(result.document)
      } catch (e) {
        if (!isCurrentLoad) {
          return
        }

        console.error('Project file load failed:', normalizeErrorMessage(e))
        const message =
          e instanceof Error
            ? e.message
            : 'Unexpected error while loading project file.'
        setLoadError({
          key: currentDocumentKey,
          message,
        })
      }
    }

    readFileContent()

    return () => {
      isCurrentLoad = false
    }
  }, [
    contentPath,
    documentKey,
    fileFormat,
    createMode,
    jupyterServer,
    jupyterServerBaseUrl,
    project_id,
    projectFileCoordinator,
    requestedContentPath,
    resolvedFilePath,
    pathResolutionKey,
    routeNeedsRetarget,
    sharedLockController,
    sharedLockReady,
    commitLoadedDocument,
    setLoadedDocumentForKey,
  ])

  /**
   * Autosaves dirty active documents after a debounce when save conditions are met.
   */
  useEffect(() => {
    if (
      renameLockRef.current ||
      routeNeedsRetarget ||
      !shouldAutosaveDocument({
        loadedDocument: activeLoadedDocument,
        currentDocumentKey: documentKey,
        jupyterServer,
        jupyterServerBaseUrl,
        activeLoadError,
      })
    ) {
      return
    }

    const documentToSave = activeLoadedDocument
    if (!documentToSave || !jupyterServer || !jupyterServerBaseUrl) {
      return
    }
    if (!shouldAttemptAutomaticSave(documentToSave, autosaveFailure)) {
      return
    }

    const saveTimeout = window.setTimeout(() => {
      if (renameLockRef.current) {
        return
      }

      saveDocumentSnapshot(documentToSave).catch((err) => {
        console.error('Autosave failed:', normalizeErrorMessage(err))
      })
    }, 3000)

    return () => window.clearTimeout(saveTimeout)
  }, [
    activeLoadError,
    activeLoadedDocument,
    autosaveFailure,
    documentKey,
    jupyterServer,
    jupyterServerBaseUrl,
    renameLocked,
    routeNeedsRetarget,
    saveDocumentSnapshot,
  ])

  /** Retries the latest dirty snapshot even when its automatic attempt failed. */
  const retryAutosave = useCallback(() => {
    const documentToSave = getActiveLoadedDocument(
      loadedDocumentRef.current,
      documentKeyRef.current,
    )
    if (!documentToSave?.dirty || savePending) {
      return
    }

    saveDocumentSnapshot(documentToSave).catch((error) => {
      console.error('Manual save retry failed:', normalizeErrorMessage(error))
    })
  }, [saveDocumentSnapshot, savePending])

  if (routeNeedsRetarget) {
    return <code>Opening renamed file...</code>
  }

  if (sharedLockError) {
    return <code>{sharedLockError.message}</code>
  }

  if (activeLoadError) {
    return <code>{activeLoadError}</code>
  }

  if (
    activeLoadedDocument === undefined ||
    (sharedLockController !== null && !sharedLockReady) ||
    !jupyterServer ||
    !jupyterServerBaseUrl
  ) {
    return <code>Loading file...</code>
  }

  const matchedDocument = activeLoadedDocument.document
  const activeAutosaveFailure =
    autosaveFailure?.key === documentKey ? autosaveFailure : null

  const documentView = (() => {
    switch (fileFormat) {
      case 'ichat':
        return (
          <Chat
            chatData={matchedDocument.content as ChatData}
            downloadFileName={contentPath.split('/').at(-1) ?? resolvedFilePath}
            setDocumentContent={updateDocumentContent}
            onDocumentActivityChange={handleDocumentActivityChange}
            currentUser={session?.user as UserProfile}
          />
        )

      case 'ipynb':
        return (
          <Notebook
            notebookData={matchedDocument as unknown as JupyterNotebookFile}
            jupyterServers={jupyterServers}
            setDocumentContent={updateDocumentContent}
            onDocumentActivityChange={handleDocumentActivityChange}
          />
        )

      case 'ivis':
        return (
          <VisualizationDashboard
            visualizationData={
              matchedDocument.content as VisualizationFileContent
            }
            setDocumentContent={updateDocumentContent}
          />
        )

      case 'icmp': {
        try {
          classifyCampaignDocument(matchedDocument.content)
        } catch (error) {
          const message =
            error instanceof CampaignDocumentAdapterError
              ? error.message
              : 'The campaign document format is not supported.'
          return (
            <Alert color='red' title='Campaign could not be opened'>
              {message}
            </Alert>
          )
        }

        const campaignData = matchedDocument.content as CampaignModel
        const commonCampaignProps = {
          jupyterServers,
          projectId: project_id,
          downloadFileName: contentPath.split('/').at(-1) ?? resolvedFilePath,
          setDocumentContent: updateDocumentContent,
          onDocumentActivityChange: handleDocumentActivityChange,
        }

        return (
          <Campaign
            key={activeLoadedDocument.key}
            {...commonCampaignProps}
            campaignData={campaignData}
            selectedSheetId={campaignTab?.selectedCampaignSheetId}
            sheetViewports={campaignTab?.campaignSheetViewports}
            onSelectedSheetIdChange={
              campaignTab ? handleCampaignSheetChange : undefined
            }
            onSheetViewportChange={
              campaignTab ? handleCampaignViewportChange : undefined
            }
          />
        )
      }
      case 'txt':
        return (
          <TextFileViewer
            content={normalizeTextFileContent(matchedDocument.content)}
          />
        )
      case 'json':
        return (
          <TextFileViewer
            content={normalizeJsonFileContent(matchedDocument.content)}
          />
        )
      default:
        return <code>Not implemented yet</code>
    }
  })()

  return (
    <Box
      aria-busy={renameLocked}
      pos='relative'
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
      }}
    >
      <LoadingOverlay
        visible={renameLocked}
        zIndex={1000}
        overlayProps={{ blur: 1 }}
      />
      {activeAutosaveFailure && (
        <Alert color='red' title='Changes not saved'>
          <Group justify='space-between' align='center' wrap='wrap'>
            <Text size='sm'>{activeAutosaveFailure.message}</Text>
            <Button
              color='red'
              loading={savePending}
              onClick={retryAutosave}
              size='compact-sm'
              variant='light'
            >
              Retry
            </Button>
          </Group>
        </Alert>
      )}
      <Box style={{ flex: 1, minHeight: 0 }}>{documentView}</Box>
    </Box>
  )
}
