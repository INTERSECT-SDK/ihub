import {
  Anchor,
  ActionIcon,
  Box,
  Breadcrumbs,
  Button,
  Group,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
} from '@mantine/core'
import {
  IconChevronDown,
  IconChevronUp,
  IconFolder,
  IconUpload,
} from '@tabler/icons-react'
import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react'
import useSWR from 'swr'
import { usePathname, useRouter } from 'next/navigation.js'
import useTabs from '@/hooks/useTabs'
import { useActiveCampaignFiles } from '@/hooks/useActiveCampaignFiles.ts'
import {
  getFileTabTitle,
  getProjectFileRouteAfterRename,
  normalizeTabRoute,
  tabMatchesProjectFile,
} from '@/hooks/tab-state'
import { useAtomValue, useSetAtom } from 'jotai'

import classes from './style.module.css'
import { useSession } from '@/app/providers/SessionProvider.tsx'
import { NewTab } from '@/types'
import { JupyterServerConfig } from '@ihub/utils/types/notebook'
import { ContentFile } from '@ihub/utils/types/types'
import type { Project } from '@ihub/utils/types/project'
import { FileIcon } from './ViewFileServerNavigation'
import { activeTabAtom, selectedProjectIdAtom } from '@/atoms/global.ts'
import {
  OPEN_PROJECT_FILE_BUSY_ERROR,
  OPEN_PROJECT_FILE_SAVE_ERROR,
  prepareActiveProjectFileRenameAtom,
  type ProjectFileEditorRenamePreparation,
} from '@/atoms/project-file-editor.ts'
import {
  buildJupyterContentsUrl,
  buildProjectFileRoute,
  encodePathSegments,
  getProjectFileNameForDisplay,
} from '@/app/project/project-file-path.ts'
import {
  buildProjectFileCoordinationKey,
  createBrowserProjectFileCoordinator,
  normalizeProjectFileServerIdentity,
  PROJECT_FILE_COORDINATION_UNSUPPORTED_ERROR,
  PROJECT_FILE_OPEN_IN_OTHER_CONTEXT_ERROR,
  type ProjectFileRenameCompletion,
  type ProjectFileRenamePublicationResult,
} from '@/app/project/project-file-coordination.ts'
import {
  IHubIconCheck,
  IHubIconDownload,
  IHubIconEdit,
  IHubIconTrash,
  IHubIconX,
} from '@ihub/utils/icons'
import {
  buildProjectFileDownloadUrl,
  launchProjectFileDownload,
  stopProjectFileRowActionEvent,
} from './project-file-download.ts'
import {
  buildProjectFileUploadPayload,
  buildProjectUploadTargetPath,
  encodeProjectContentsPath,
  getProjectFileUploadCompletion,
  hasOpenProjectFileEditor,
  validateProjectUploadFile,
  type ProjectFileUploadPayload,
  type ProjectFileUploadPolicy,
} from './project-file-upload.ts'
import {
  buildRenamedProjectFile,
  buildProjectFileRenameUrl,
  canRenameProjectFile,
  getProjectFileRenameExtension,
  hasProjectFileRenameDuplicate,
  inspectFailedProjectFileRenameRefresh,
  initialProjectFileRenameState,
  projectFileRenameReducer,
  shouldReleasePreparedEditorAfterCommittedRename,
  validateProjectFileRename,
} from './project-file-rename.ts'
import {
  getNextProjectFileSortState,
  getProjectFileDisplayName,
  getProjectFileModifiedLabel,
  getProjectFileType,
  sortProjectFiles,
  type ProjectFileSort,
  type ProjectFileSortDirection,
  type ProjectFileSortState,
} from './project-file-sort.ts'
import ActiveCampaignIndicator from '../ActiveCampaignIndicator/ActiveCampaignIndicator.tsx'
import { isCampaignFile } from './project-file-active-campaigns.ts'

/**
 * Requests a project-directory listing from Jupyter contents API.
 */
const fetcher = async ({ url, token }: { url: string; token: string }) => {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
    },
  })

  if (!response.ok) {
    throw new Error('Network error getting list of project files')
  }

  return response.json()
}

/**
 * Fetches project-scoped API resources used by the navigator UI.
 */
const apiFetcher = async (url: string) => {
  const response = await fetch(url, {
    headers: { 'Cache-Control': 'no-cache' },
  })

  if (!response.ok) {
    throw new Error('Unable to load project upload settings')
  }

  return response.json()
}

interface DisplayProjectFileNavigatorProps {
  servers: JupyterServerConfig[]
}

/**
 * Entry component that resolves the selected project and file server context
 * before rendering the project file tree.
 */
export default function DisplayProjectFileNavigator({
  servers,
}: DisplayProjectFileNavigatorProps) {
  const server = servers?.[0]
  const selectedProjectId = useAtomValue(selectedProjectIdAtom)
  const projectRootPath = selectedProjectId
    ? `projects/${selectedProjectId}`
    : null

  if (!server) {
    return <Text size='xs'>No file server connected.</Text>
  }

  if (!selectedProjectId || !projectRootPath) {
    return <Text size='xs'>Select a project to view project files.</Text>
  }

  return (
    <ProjectFileTree
      server={server}
      projectRootPath={projectRootPath}
      projectId={selectedProjectId}
    />
  )
}

interface ProjectFileTreeProps {
  server: JupyterServerConfig
  projectRootPath: string
  projectId: string
}

interface ProjectFileNavItemProps {
  item: ContentFile
  isSelected: boolean
  isActiveView: boolean
  isConfirmingDelete: boolean
  isDeleting: boolean
  isCampaignActive: boolean
  canRename: boolean
  renameDisabledReason: string | null
  isEditingRename: boolean
  isSubmittingRename: boolean
  renameActionsDisabled: boolean
  renameValue: string
  renameExtension: string
  renameError: string | null
  onSelect: () => void
  onOpen: () => void
  onDownload: (event: MouseEvent<HTMLButtonElement>) => void
  onRenameValueChange: (event: ChangeEvent<HTMLInputElement>) => void
  onRenameKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void
  onRequestRename: (event: MouseEvent<HTMLButtonElement>) => void
  onCancelRename: (event: MouseEvent<HTMLButtonElement>) => void
  onConfirmRename: (event: MouseEvent<HTMLButtonElement>) => void
  onRequestDelete: (event: MouseEvent<HTMLButtonElement>) => void
  onCancelDelete: (event: MouseEvent<HTMLButtonElement>) => void
  onConfirmDelete: (event: MouseEvent<HTMLButtonElement>) => void
}

interface CapturedUploadRequest {
  projectId: string
  currentPath: string
  targetPath: string
  filename: string
  jupyterUser: string
  jupyterServerUrl: string
  jupyterToken: string
  payload: ProjectFileUploadPayload
  refreshListing: () => Promise<unknown>
}

type UploadMessage = {
  kind: 'uploading' | 'success' | 'error'
  text: string
}

type RenameMessage = {
  kind: 'error' | 'warning'
  text: string
}

function combineProjectFileRenameWarnings(
  ...warnings: Array<string | undefined>
): string | undefined {
  const messages = warnings.filter(
    (warning): warning is string => warning !== undefined,
  )
  return messages.length > 0 ? messages.join(' ') : undefined
}

/**
 * Renders and manages project file navigation, upload, download, and delete
 * interactions for the currently selected project.
 */
function ProjectFileTree({
  server,
  projectRootPath,
  projectId,
}: ProjectFileTreeProps) {
  const [currentPath, setCurrentPath] = useState(projectRootPath)
  const [contentList, setContentList] = useState<ContentFile[]>([])
  const [selectedItem, setSelectedItem] = useState<string | null>(null)
  const [sortState, setSortState] = useState<ProjectFileSortState>({
    sortBy: 'name',
    direction: 'ascending',
  })
  const [confirmingDeletePath, setConfirmingDeletePath] = useState<
    string | null
  >(null)
  const [deletingPath, setDeletingPath] = useState<string | null>(null)
  const [pendingOverwrite, setPendingOverwrite] =
    useState<CapturedUploadRequest | null>(null)
  const [uploadMessage, setUploadMessage] = useState<UploadMessage | null>(null)
  const [renameState, dispatchRename] = useReducer(
    projectFileRenameReducer,
    initialProjectFileRenameState,
  )
  const [renameMessage, setRenameMessage] = useState<RenameMessage | null>(null)
  const projectFileCoordinator = useMemo(
    () => createBrowserProjectFileCoordinator(),
    [],
  )
  const renameSubmissionRef = useRef(false)
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const pathname = usePathname()
  const navigatorContextRef = useRef({ projectId, currentPath, pathname })
  const {
    addAndActivateTab,
    closeTabsForDeletedProjectFile,
    openTabs,
    renameInactiveProjectFileTabs,
    renameTabsForProjectFile,
  } = useTabs()
  const openTabsRef = useRef(openTabs)
  const renameTabsForProjectFileRef = useRef(renameTabsForProjectFile)
  const renameInactiveProjectFileTabsRef = useRef(renameInactiveProjectFileTabs)
  const activeTab = useAtomValue(activeTabAtom)
  const prepareActiveProjectFileRename = useSetAtom(
    prepareActiveProjectFileRenameAtom,
  )
  const { session } = useSession()
  const router = useRouter()
  const jupyterUser =
    getJupyterUserFromServerUrl(server.url) ?? session?.user?.email

  /**
   * Resets local selection and delete state when the user switches projects.
   */
  useEffect(() => {
    setCurrentPath(projectRootPath)
    setSelectedItem(null)
    setConfirmingDeletePath(null)
    setDeletingPath(null)
    dispatchRename({ type: 'cancel' })
    setRenameMessage(null)
  }, [projectRootPath])

  const fileListKey = buildJupyterContentsUrl(server.url, currentPath)
  const { data, mutate } = useSWR(
    { url: fileListKey, token: server.token },
    fetcher,
  )
  const { data: selectedProject, error: projectError } = useSWR<Project>(
    `/api/v1/projects/${projectId}`,
    apiFetcher,
  )
  const { data: uploadPolicy, error: policyError } =
    useSWR<ProjectFileUploadPolicy>(
      '/api/v1/contents/upload-policy',
      apiFetcher,
    )
  navigatorContextRef.current = { projectId, currentPath, pathname }
  openTabsRef.current = openTabs
  renameTabsForProjectFileRef.current = renameTabsForProjectFile
  renameInactiveProjectFileTabsRef.current = renameInactiveProjectFileTabs

  /**
   * Apply rename completions from another browser context and refresh a
   * currently visible affected directory.
   */
  useEffect(
    () =>
      projectFileCoordinator.subscribe(
        (completion: ProjectFileRenameCompletion) => {
          if (
            normalizeProjectFileServerIdentity(completion.serverIdentity) !==
              normalizeProjectFileServerIdentity(server.url) ||
            completion.projectId !== projectId
          ) {
            return
          }

          renameInactiveProjectFileTabsRef.current(
            projectId,
            completion.oldContentPath,
            completion.newContentPath,
            completion.newFilename,
          )

          const affectedDirectory = completion.oldContentPath.slice(
            0,
            completion.oldContentPath.lastIndexOf('/'),
          )
          if (
            navigatorContextRef.current.projectId === projectId &&
            navigatorContextRef.current.currentPath === affectedDirectory
          ) {
            void mutate().catch((error) => {
              console.error(
                'Failed to refresh project files after a remote rename',
                {
                  path: completion.newContentPath,
                  error,
                },
              )
            })
          }
        },
      ),
    [mutate, projectFileCoordinator, projectId, server.url],
  )

  /**
   * Synchronizes the visible list with the latest SWR response.
   */
  useEffect(() => {
    if (data !== undefined) {
      setContentList(data.content ?? [])
      setConfirmingDeletePath(null)
    }
  }, [data])

  /**
   * Clears transient upload/delete prompts when navigating to another folder.
   */
  useEffect(() => {
    setConfirmingDeletePath(null)
    setPendingOverwrite(null)
    setUploadMessage(null)
    dispatchRename({ type: 'cancel' })
    setRenameMessage(null)
  }, [currentPath])

  /**
   * Determines whether a captured upload request still points to the currently
   * visible project and directory in the navigator.
   */
  const isCapturedContextVisible = (request: CapturedUploadRequest) =>
    navigatorContextRef.current.projectId === request.projectId &&
    navigatorContextRef.current.currentPath === request.currentPath

  /**
   * Uploads a project file and handles overwrite conflicts when an existing
   * file is present at the target path.
   */
  const uploadFile = async (
    request: CapturedUploadRequest,
    overwrite: boolean,
  ) => {
    if (isCapturedContextVisible(request)) {
      setUploadMessage({
        kind: 'uploading',
        text: overwrite
          ? `Overwriting ${request.filename}...`
          : `Uploading ${request.filename}...`,
      })
    }

    const params = new URLSearchParams({
      jupyter_user: request.jupyterUser,
      jupyter_server_url: request.jupyterServerUrl,
      overwrite: String(overwrite),
    })
    const url = `/api/v1/contents/save/${encodeProjectContentsPath(
      request.targetPath,
    )}?${params.toString()}`

    try {
      const response = await fetch(url, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${request.jupyterToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request.payload),
      })

      if (response.status === 409 && !overwrite) {
        if (!isCapturedContextVisible(request)) {
          return
        }

        const hasOpenEditor = hasOpenProjectFileEditor(
          openTabsRef.current,
          request.projectId,
          request.targetPath,
        )
        if (hasOpenEditor) {
          setUploadMessage({
            kind: 'error',
            text: `Close the open ${request.filename} editor tab before overwriting it.`,
          })
          return
        }

        setPendingOverwrite(request)
        setUploadMessage(null)
        return
      }

      if (!response.ok) {
        throw new Error(await getUploadErrorMessage(response))
      }

      if (isCapturedContextVisible(request)) {
        setPendingOverwrite(null)
      }
    } catch (error) {
      if (isCapturedContextVisible(request)) {
        setUploadMessage({
          kind: 'error',
          text:
            error instanceof Error
              ? error.message
              : 'Unable to upload the selected file.',
        })
      }
      return
    }

    const completion = await getProjectFileUploadCompletion(
      request.filename,
      () =>
        projectFileCoordinator.invalidateRenameMapping(
          request.jupyterServerUrl,
          request.projectId,
          request.targetPath,
        ),
      request.refreshListing,
    )
    if (!completion.mappingRemovalSucceeded) {
      console.error('Failed to remove a stale project-file rename mapping', {
        path: request.targetPath,
      })
    }
    if ('refreshError' in completion) {
      console.error('Failed to refresh project files after upload', {
        path: request.targetPath,
        error: completion.refreshError,
      })
    }

    if (isCapturedContextVisible(request)) {
      setUploadMessage({
        kind: 'success',
        text: completion.message,
      })
    }
  }

  /** Revalidates editor state before confirming an existing-file overwrite. */
  const handleConfirmOverwrite = () => {
    const request = pendingOverwrite
    if (!request) {
      return
    }

    if (
      hasOpenProjectFileEditor(
        openTabsRef.current,
        request.projectId,
        request.targetPath,
      )
    ) {
      setPendingOverwrite(null)
      if (isCapturedContextVisible(request)) {
        setUploadMessage({
          kind: 'error',
          text: `Close the open ${request.filename} editor tab before overwriting it.`,
        })
      }
      return
    }

    setPendingOverwrite(null)
    void uploadFile(request, true)
  }

  /**
   * Validates the selected local file, captures the current navigation context,
   * and starts an upload request.
   */
  const handleUploadSelection = async (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !uploadPolicy || !jupyterUser) {
      return
    }

    setPendingOverwrite(null)
    const validationError = validateProjectUploadFile(file, uploadPolicy)
    if (validationError) {
      setUploadMessage({ kind: 'error', text: validationError })
      return
    }

    const capturedContext = {
      projectId,
      currentPath,
      targetPath: buildProjectUploadTargetPath(currentPath, file.name),
      filename: file.name,
      jupyterUser,
      jupyterServerUrl: server.url,
      jupyterToken: server.token,
      refreshListing: mutate,
    }

    setUploadMessage({
      kind: 'uploading',
      text: `Uploading ${file.name}...`,
    })

    try {
      const payload = buildProjectFileUploadPayload(await file.arrayBuffer())
      await uploadFile({ ...capturedContext, payload }, false)
    } catch {
      if (
        navigatorContextRef.current.projectId === capturedContext.projectId &&
        navigatorContextRef.current.currentPath === capturedContext.currentPath
      ) {
        setUploadMessage({
          kind: 'error',
          text: 'Unable to read the selected file.',
        })
      }
    }
  }

  /**
   * Opens directories in-place and opens files in an editor tab scoped to the
   * selected project.
   */
  const handleDoubleClick = (clickedNode: ContentFile) => {
    if (clickedNode.type === 'directory') {
      setCurrentPath(clickedNode.path)
      return
    }

    const prefix = `${projectRootPath}/`
    if (!clickedNode.path.startsWith(prefix)) {
      return
    }

    const filePath = clickedNode.path.slice(prefix.length)
    if (!filePath) {
      return
    }

    const fileRoute = buildProjectFileRoute(projectId, filePath)
    const newTab: NewTab = {
      id: Date.now(),
      title: getFileTabTitle(clickedNode.name),
      name: clickedNode.path,
      path: fileRoute,
    }

    void addAndActivateTab(newTab)
  }

  /**
   * Deletes a file through the backend proxy, updates local state, and closes
   * any open editor tabs that reference the removed file.
   */
  const handleDeleteFile = async (item: ContentFile) => {
    if (item.type === 'directory' || !jupyterUser) {
      return
    }

    setDeletingPath(item.path)

    const encodedPath = encodePathSegments(item.path)
    const params = new URLSearchParams({
      jupyter_user: jupyterUser,
      jupyter_server_url: server.url,
    })

    const proxyDeleteUrl = `/api/v1/contents/delete/${encodedPath}?${params.toString()}`

    try {
      const response = await fetch(proxyDeleteUrl, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${server.token}`,
        },
      })

      if (!response.ok) {
        const body = await response.text()
        console.error('Failed to delete project file', {
          path: item.path,
          status: response.status,
          body,
        })
        return
      }

      setContentList((items) =>
        items.filter((contentItem) => contentItem.path !== item.path),
      )
      setConfirmingDeletePath(null)

      const closeTabsResult = closeTabsForDeletedProjectFile(
        projectId,
        item.path,
      )

      if (closeTabsResult.activeTabWasClosed) {
        router.push(
          closeTabsResult.nextActiveTab
            ? normalizeTabRoute(closeTabsResult.nextActiveTab.path)
            : `/project/${projectId}`,
        )
      }

      await mutate()
    } catch (error) {
      console.error('Failed to delete project file', {
        path: item.path,
        error,
      })
    } finally {
      setDeletingPath(null)
    }
  }

  /** Starts an inline same-directory rename for a writable project file. */
  const handleRequestRename = (item: ContentFile) => {
    if (renameSubmissionRef.current) {
      return
    }

    setConfirmingDeletePath(null)
    setRenameMessage(null)
    dispatchRename({
      type: 'start',
      itemPath: item.path,
      originalName: item.name,
    })
  }

  /** Validates and persists the active same-directory project-file rename. */
  const handleRenameFile = async () => {
    if (
      renameSubmissionRef.current ||
      renameState.status !== 'editing' ||
      !jupyterUser
    ) {
      return
    }

    const validation = validateProjectFileRename(
      renameState.itemPath,
      renameState.originalName,
      renameState.value,
    )
    if (validation.kind === 'unchanged') {
      dispatchRename({ type: 'cancel' })
      return
    }
    if (validation.kind === 'invalid') {
      dispatchRename({ type: 'fail', error: validation.message })
      return
    }
    if (hasProjectFileRenameDuplicate(contentList, validation.targetPath)) {
      dispatchRename({
        type: 'fail',
        error: 'A file with this name already exists.',
      })
      return
    }

    renameSubmissionRef.current = true
    const capturedContext = { projectId, currentPath, pathname }
    const oldPath = renameState.itemPath
    const originalName = renameState.originalName
    dispatchRename({ type: 'submit' })
    setRenameMessage(null)

    let preparedEditor: Extract<
      ProjectFileEditorRenamePreparation,
      { status: 'prepared' }
    > | null = null
    let didNavigate = false
    let serverRenameCommitted = false
    let publicationResult: ProjectFileRenamePublicationResult | null = null

    const isCapturedContextVisible = () =>
      navigatorContextRef.current.projectId === capturedContext.projectId &&
      navigatorContextRef.current.currentPath === capturedContext.currentPath
    const isCapturedRouteCurrent = () =>
      navigatorContextRef.current.pathname === capturedContext.pathname

    const applyEffectiveRename = (
      renamedModel: Partial<ContentFile>,
      warningText?: string,
    ) => {
      serverRenameCommitted = true
      const completion: ProjectFileRenameCompletion = {
        type: 'project-file-renamed',
        serverIdentity: server.url,
        projectId,
        oldContentPath: oldPath,
        newContentPath: validation.targetPath,
        newFilename: validation.filename,
      }
      publicationResult = projectFileCoordinator.publishRename(completion)
      if (publicationResult.failedStages.length > 0) {
        console.error(
          'Project-file rename browser publication was incomplete',
          {
            path: validation.targetPath,
            failedStages: publicationResult.failedStages,
          },
        )
      }

      if (isCapturedContextVisible()) {
        setContentList((items) =>
          items.map((item) =>
            item.path === oldPath
              ? buildRenamedProjectFile(
                  item,
                  renamedModel,
                  validation.filename,
                  validation.targetPath,
                )
              : item,
          ),
        )
        setSelectedItem((itemPath) =>
          itemPath === oldPath ? validation.targetPath : itemPath,
        )
      }

      const renamedTabs = renameTabsForProjectFile(
        projectId,
        oldPath,
        validation.targetPath,
        validation.filename,
      )
      const preparedEditorFreshness = preparedEditor
        ? preparedEditor.isCurrent()
          ? 'current'
          : 'stale'
        : 'not-prepared'
      const renamedRoute = getProjectFileRouteAfterRename(
        projectId,
        validation.targetPath,
        {
          activeTabWasRenamed: renamedTabs.activeTabWasRenamed,
          preparedEditorFreshness,
        },
      )
      if (renamedRoute && isCapturedRouteCurrent()) {
        didNavigate = true
        router.replace(renamedRoute)
      }

      const publicationWarning =
        publicationResult.failedStages.length > 0
          ? `${validation.filename} was renamed, but browser synchronization was incomplete.`
          : undefined
      const lockedEditorWarning =
        preparedEditor &&
        !didNavigate &&
        !publicationResult.persistentMappingSucceeded
          ? 'The editor remains paused; reopen the renamed file from project navigation before continuing to edit.'
          : undefined
      const combinedWarning = combineProjectFileRenameWarnings(
        warningText,
        publicationWarning,
        lockedEditorWarning,
      )
      if (combinedWarning && isCapturedContextVisible()) {
        setRenameMessage({ kind: 'warning', text: combinedWarning })
      }

      dispatchRename({ type: 'succeed' })
    }

    const reconcileFailedRename = async (
      renameError: string,
    ): Promise<'effective' | 'restore'> => {
      let refreshedItems: ContentFile[] | undefined
      try {
        refreshedItems = getProjectFileListingItems(await mutate())
      } catch (refreshError) {
        console.error('Failed to refresh project files after rename error', {
          path: oldPath,
          error: refreshError,
        })
      }

      if (isCapturedContextVisible() && refreshedItems) {
        setContentList(refreshedItems)
      }

      const refreshState = inspectFailedProjectFileRenameRefresh(
        refreshedItems,
        oldPath,
        validation.targetPath,
      )
      if (refreshState.kind === 'target-present') {
        applyEffectiveRename(
          {},
          `${validation.filename} appears to have been renamed, but the server reported: ${renameError}`,
        )
        return 'effective'
      }

      if (
        refreshState.kind === 'ambiguous' ||
        refreshState.kind === 'unavailable'
      ) {
        dispatchRename({ type: 'succeed' })
        if (isCapturedContextVisible()) {
          setRenameMessage({
            kind: 'error',
            text: `The rename result is unclear. Refresh the project files before retrying. The server reported: ${renameError}`,
          })
        }
        return 'restore'
      }

      if (isCapturedContextVisible()) {
        dispatchRename({ type: 'fail', error: renameError })
      } else {
        dispatchRename({ type: 'succeed' })
      }
      return 'restore'
    }

    try {
      try {
        const preparation = await prepareActiveProjectFileRename(
          server.url,
          projectId,
          oldPath,
        )
        if (preparation?.status === 'busy') {
          dispatchRename({
            type: 'fail',
            error: OPEN_PROJECT_FILE_BUSY_ERROR,
          })
          return
        }
        preparedEditor = preparation
      } catch (error) {
        console.error('Failed to save the open project file before rename', {
          path: oldPath,
          error,
        })
        dispatchRename({ type: 'fail', error: OPEN_PROJECT_FILE_SAVE_ERROR })
        return
      }

      const coordinationKey = buildProjectFileCoordinationKey(
        server.url,
        projectId,
        oldPath,
      )
      const exclusiveResult = await projectFileCoordinator.runExclusive(
        coordinationKey,
        async (): Promise<'effective' | 'restore'> => {
          try {
            const response = await fetch(
              buildProjectFileRenameUrl(oldPath, jupyterUser, server.url),
              {
                method: 'PATCH',
                headers: {
                  Authorization: `Bearer ${server.token}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ path: validation.targetPath }),
              },
            )

            if (!response.ok) {
              return await reconcileFailedRename(
                await getRenameErrorMessage(response),
              )
            }

            serverRenameCommitted = true
            let renamedModel: Partial<ContentFile> = {}
            let responseWarning: string | undefined
            try {
              renamedModel = (await response.json()) as Partial<ContentFile>
            } catch (error) {
              console.error(
                'Failed to read the completed project-file rename response',
                {
                  path: validation.targetPath,
                  error,
                },
              )
              responseWarning = `${validation.filename} was renamed, but the server response could not be read.`
            }
            applyEffectiveRename(renamedModel, responseWarning)

            try {
              await mutate()
            } catch (error) {
              console.error('Failed to refresh project files after rename', {
                path: validation.targetPath,
                error,
              })
              if (isCapturedContextVisible()) {
                setRenameMessage((currentMessage) => ({
                  kind: 'warning',
                  text:
                    combineProjectFileRenameWarnings(
                      currentMessage?.kind === 'warning'
                        ? currentMessage.text
                        : undefined,
                      `${validation.filename} was renamed, but the file list could not be refreshed.`,
                    ) ??
                    `${validation.filename} was renamed, but the file list could not be refreshed.`,
                }))
              }
            }
            return 'effective'
          } catch (error) {
            return await reconcileFailedRename(
              error instanceof Error
                ? error.message
                : `Unable to rename ${originalName}.`,
            )
          }
        },
      )

      if (exclusiveResult.status === 'blocked') {
        await preparedEditor?.restore()
        dispatchRename({
          type: 'fail',
          error: PROJECT_FILE_OPEN_IN_OTHER_CONTEXT_ERROR,
        })
        return
      }
      if (exclusiveResult.status === 'unsupported') {
        await preparedEditor?.restore()
        dispatchRename({
          type: 'fail',
          error: PROJECT_FILE_COORDINATION_UNSUPPORTED_ERROR,
        })
        return
      }

      if (exclusiveResult.value === 'restore') {
        if (!serverRenameCommitted) {
          await preparedEditor?.restore()
        }
      } else if (
        shouldReleasePreparedEditorAfterCommittedRename(
          publicationResult,
          didNavigate,
        )
      ) {
        preparedEditor?.release()
      }
    } catch (error) {
      console.error('Project-file rename coordination failed', {
        path: oldPath,
        error,
      })
      if (serverRenameCommitted) {
        dispatchRename({ type: 'succeed' })
        if (
          shouldReleasePreparedEditorAfterCommittedRename(
            publicationResult,
            didNavigate,
          )
        ) {
          preparedEditor?.release()
        }
        if (isCapturedContextVisible()) {
          setRenameMessage((currentMessage) => ({
            kind: 'warning',
            text:
              combineProjectFileRenameWarnings(
                currentMessage?.kind === 'warning'
                  ? currentMessage.text
                  : undefined,
                `${validation.filename} was renamed, but local browser coordination was incomplete. Reopen the renamed file from project navigation before continuing to edit.`,
              ) ??
              `${validation.filename} was renamed, but local browser coordination was incomplete. Reopen the renamed file from project navigation before continuing to edit.`,
          }))
        }
        return
      }

      await preparedEditor?.restore()
      dispatchRename({
        type: 'fail',
        error:
          'Unable to coordinate the rename safely. Refresh before retrying.',
      })
    } finally {
      renameSubmissionRef.current = false
    }
  }

  /**
   * Starts a browser download for a project file using the signed/proxied URL.
   */
  const handleDownloadFile = (item: ContentFile) => {
    if (item.type === 'directory' || !jupyterUser) {
      return
    }

    launchProjectFileDownload(
      buildProjectFileDownloadUrl(item.path, jupyterUser, server.url),
      item.name,
    )
  }

  const relativePath =
    currentPath === projectRootPath
      ? ''
      : currentPath.replace(`${projectRootPath}/`, '')
  const relativePathSplit = relativePath ? relativePath.split('/') : []

  const breadcrumbs = [
    <Anchor
      size='xs'
      key='root-bc'
      onClick={() => setCurrentPath(projectRootPath)}
    >
      <IconFolder size={'12'} />
    </Anchor>,
    ...relativePathSplit.map((item, index) => {
      const targetPath = `${projectRootPath}/${relativePathSplit
        .slice(0, index + 1)
        .join('/')}`
      return (
        <Anchor
          size='xs'
          key={`bc_${index}`}
          onClick={() => setCurrentPath(targetPath)}
        >
          {item}
        </Anchor>
      )
    }),
  ]

  const sortedContentList = useMemo(
    () => sortProjectFiles(contentList, sortState.sortBy, sortState.direction),
    [contentList, sortState.direction, sortState.sortBy],
  )
  const campaignFiles = useMemo(
    () => sortedContentList.filter(isCampaignFile),
    [sortedContentList],
  )
  const activeCampaignFilePaths = useActiveCampaignFiles(campaignFiles)

  const handleSortChange = (nextSortBy: ProjectFileSort) => {
    setSortState((currentState) =>
      getNextProjectFileSortState(currentState, nextSortBy),
    )
  }

  const uploadDisabledReason = projectError
    ? 'Unable to verify project edit access.'
    : policyError
      ? 'Unable to load the upload policy.'
      : selectedProject?.current_user_access_level === 'view'
        ? 'Edit access is required to upload files.'
        : !selectedProject || !uploadPolicy
          ? 'Loading upload settings...'
          : !jupyterUser
            ? 'A Jupyter user is required to upload files.'
            : null
  const isUploading = uploadMessage?.kind === 'uploading'
  const uploadTooltip = uploadDisabledReason
    ? uploadDisabledReason
    : uploadPolicy
      ? `Upload a file. Supported file types: ${uploadPolicy.supported_extensions.join(', ')}.`
      : 'Upload a file'

  return (
    <>
      <Group justify='space-between' m='xs' wrap='nowrap'>
        <Breadcrumbs>{breadcrumbs}</Breadcrumbs>
        <>
          <input
            ref={uploadInputRef}
            hidden
            type='file'
            accept={uploadPolicy?.supported_extensions.join(',')}
            onChange={(event) => void handleUploadSelection(event)}
          />
          <Tooltip label={uploadTooltip}>
            <span>
              <Button
                aria-label='Upload file'
                disabled={uploadDisabledReason !== null || isUploading}
                leftSection={<IconUpload size={14} />}
                loading={isUploading}
                size='xs'
                variant='subtle'
                onClick={() => uploadInputRef.current?.click()}
              >
                Upload file
              </Button>
            </span>
          </Tooltip>
        </>
      </Group>
      {uploadMessage && (
        <Text
          c={
            uploadMessage.kind === 'error'
              ? 'red'
              : uploadMessage.kind === 'success'
                ? 'green'
                : 'dimmed'
          }
          mx='xs'
          size='xs'
        >
          {uploadMessage.text}
        </Text>
      )}
      {pendingOverwrite && (
        <Group gap='xs' mx='xs'>
          <Text size='xs'>Replace existing {pendingOverwrite.filename}?</Text>
          <Button
            color='red'
            size='compact-xs'
            onClick={handleConfirmOverwrite}
          >
            Overwrite
          </Button>
          <Button
            size='compact-xs'
            variant='default'
            onClick={() => setPendingOverwrite(null)}
          >
            Cancel
          </Button>
        </Group>
      )}
      {renameMessage && (
        <Text
          c={renameMessage.kind === 'error' ? 'red' : 'orange'}
          mx='xs'
          size='xs'
        >
          {renameMessage.text}
        </Text>
      )}
      <Box
        aria-label='Project files'
        className={classes.fileNavTable}
        mt='sm'
        role='table'
      >
        <ProjectFileTableHeader
          sortBy={sortState.sortBy}
          sortDirection={sortState.direction}
          onSortChange={handleSortChange}
        />

        {sortedContentList.length === 0 ? (
          <Box role='row'>
            <Text role='cell' size='xs'>
              No project files or folders to show.
            </Text>
          </Box>
        ) : (
          sortedContentList.map((item: ContentFile) => {
            const itemRenameState =
              renameState.status !== 'idle' &&
              renameState.itemPath === item.path
                ? renameState
                : null
            const isSubmittingRename = itemRenameState?.status === 'submitting'

            return (
              <ProjectFileNavItem
                key={`project_nav_file_${item.path}`}
                item={item}
                isSelected={selectedItem === item.path}
                isActiveView={tabMatchesProjectFile(
                  activeTab,
                  projectId,
                  item.path,
                )}
                isConfirmingDelete={confirmingDeletePath === item.path}
                isDeleting={deletingPath === item.path}
                isCampaignActive={
                  activeCampaignFilePaths?.includes(item.path) ?? false
                }
                canRename={canRenameProjectFile(
                  item,
                  selectedProject?.current_user_access_level,
                )}
                renameDisabledReason={
                  projectFileCoordinator.supported
                    ? null
                    : PROJECT_FILE_COORDINATION_UNSUPPORTED_ERROR
                }
                isEditingRename={itemRenameState !== null}
                isSubmittingRename={isSubmittingRename}
                renameActionsDisabled={renameState.status === 'submitting'}
                renameValue={itemRenameState?.value ?? ''}
                renameExtension={
                  itemRenameState
                    ? getProjectFileRenameExtension(
                        itemRenameState.originalName,
                      )
                    : ''
                }
                renameError={itemRenameState?.error ?? null}
                onSelect={() => setSelectedItem(item.path)}
                onOpen={() => handleDoubleClick(item)}
                onDownload={(event) => {
                  stopProjectFileRowActionEvent(event)
                  handleDownloadFile(item)
                }}
                onRenameValueChange={(event) =>
                  dispatchRename({ type: 'change', value: event.target.value })
                }
                onRenameKeyDown={(event) => {
                  event.stopPropagation()
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void handleRenameFile()
                  } else if (event.key === 'Escape') {
                    event.preventDefault()
                    dispatchRename({ type: 'cancel' })
                  }
                }}
                onRequestRename={(event) => {
                  stopProjectFileRowActionEvent(event)
                  handleRequestRename(item)
                }}
                onCancelRename={(event) => {
                  stopProjectFileRowActionEvent(event)
                  dispatchRename({ type: 'cancel' })
                }}
                onConfirmRename={(event) => {
                  stopProjectFileRowActionEvent(event)
                  void handleRenameFile()
                }}
                onRequestDelete={(event) => {
                  event.stopPropagation()
                  setConfirmingDeletePath(item.path)
                }}
                onCancelDelete={(event) => {
                  event.stopPropagation()
                  setConfirmingDeletePath(null)
                }}
                onConfirmDelete={(event) => {
                  event.stopPropagation()
                  void handleDeleteFile(item)
                }}
              />
            )
          })
        )}
      </Box>
    </>
  )
}

/**
 * Extracts a user-facing upload error message from an API response.
 */
async function getUploadErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown }
    if (typeof body.detail === 'string' && body.detail.trim()) {
      return body.detail
    }
  } catch {
    // Fall back to a stable user-safe message when the response is not JSON.
  }

  return 'Unable to upload the selected file.'
}

/** Extracts a user-facing rename error without exposing response internals. */
async function getRenameErrorMessage(response: Response): Promise<string> {
  if (response.status === 409) {
    return 'A file with this name already exists.'
  }

  try {
    const body = (await response.json()) as { detail?: unknown }
    if (typeof body.detail === 'string' && body.detail.trim()) {
      return body.detail
    }
  } catch {
    // Fall back to a stable user-safe message when the response is not JSON.
  }

  return 'Unable to rename this file.'
}

/** Extracts a usable contents array from an SWR directory refresh result. */
function getProjectFileListingItems(value: unknown): ContentFile[] | undefined {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('content' in value) ||
    !Array.isArray(value.content)
  ) {
    return undefined
  }

  return value.content.every(
    (item) =>
      typeof item === 'object' &&
      item !== null &&
      'path' in item &&
      typeof item.path === 'string',
  )
    ? (value.content as ContentFile[])
    : undefined
}

interface ProjectFileTableHeaderProps {
  sortBy: ProjectFileSort
  sortDirection: ProjectFileSortDirection
  onSortChange: (sortBy: ProjectFileSort) => void
}

const projectFileTableHeaders: Array<{
  className?: string
  label: string
  value: ProjectFileSort
}> = [
  { label: 'Name', value: 'name' },
  {
    className: classes.fileNavLastModified,
    label: 'Last modified',
    value: 'lastModified',
  },
  {
    className: classes.fileNavType,
    label: 'Type',
    value: 'type',
  },
]

/**
 * Renders clickable navigator column headers and the active sort direction.
 */
function ProjectFileTableHeader({
  sortBy,
  sortDirection,
  onSortChange,
}: ProjectFileTableHeaderProps) {
  return (
    <Box className={classes.fileNavHeader} role='row'>
      {projectFileTableHeaders.map((header) => {
        const isActive = sortBy === header.value
        const ariaSort = isActive ? sortDirection : 'none'

        return (
          <UnstyledButton
            aria-label={`Sort by ${header.label}`}
            aria-sort={ariaSort}
            className={[classes.fileNavHeaderButton, header.className]
              .filter(Boolean)
              .join(' ')}
            data-active={isActive || undefined}
            key={header.value}
            role='columnheader'
            onClick={() => onSortChange(header.value)}
          >
            <Text fw={isActive ? 600 : 500} size='xs' truncate>
              {header.label}
            </Text>
            {isActive &&
              (sortDirection === 'ascending' ? (
                <IconChevronUp aria-hidden='true' size={12} />
              ) : (
                <IconChevronDown aria-hidden='true' size={12} />
              ))}
          </UnstyledButton>
        )
      })}
      <Box aria-label='Actions' role='columnheader' />
    </Box>
  )
}

/**
 * Renders a single row in the project file navigator with open/download/delete
 * interactions.
 */
function ProjectFileNavItem({
  item,
  isSelected,
  isActiveView,
  isConfirmingDelete,
  isDeleting,
  isCampaignActive,
  canRename,
  renameDisabledReason,
  isEditingRename,
  isSubmittingRename,
  renameActionsDisabled,
  renameValue,
  renameExtension,
  renameError,
  onSelect,
  onOpen,
  onDownload,
  onRenameValueChange,
  onRenameKeyDown,
  onRequestRename,
  onCancelRename,
  onConfirmRename,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: ProjectFileNavItemProps) {
  const isFolder = item.type === 'directory'
  const stopRowDoubleClick = stopProjectFileRowActionEvent

  return (
    <Box
      className={classes.fileNavItem}
      data-active={isSelected}
      data-current={isActiveView || undefined}
      data-project-file-path={item.path}
      aria-current={isActiveView ? 'page' : undefined}
      role='row'
      onClick={onSelect}
      onDoubleClick={onOpen}
    >
      <Group className={classes.fileNavName} gap={5} role='cell' wrap='nowrap'>
        <FileIcon name={item.name} isFolder={isFolder} />
        {isEditingRename ? (
          <>
            <TextInput
              aria-label={`Rename ${item.name} name`}
              autoFocus
              disabled={isSubmittingRename}
              error={renameError}
              size='xs'
              style={{ flex: 1 }}
              value={renameValue}
              onChange={onRenameValueChange}
              onClick={stopProjectFileRowActionEvent}
              onDoubleClick={stopProjectFileRowActionEvent}
              onKeyDown={onRenameKeyDown}
            />
            {renameExtension && (
              <Text aria-hidden='true' size='xs'>
                {renameExtension}
              </Text>
            )}
            {isCampaignActive && <ActiveCampaignIndicator />}
          </>
        ) : (
          <>
            <Tooltip
              label={getProjectFileNameForDisplay(item.name)}
              openDelay={500}
            >
              <Text
                truncate
                size='sm'
                style={{ flex: 1, minWidth: 0 }}
                fw={isActiveView ? 600 : undefined}
              >
                {getProjectFileDisplayName(item)}
              </Text>
            </Tooltip>
            {isCampaignActive && <ActiveCampaignIndicator />}
          </>
        )}
      </Group>
      <Text
        className={`${classes.fileNavMetadata} ${classes.fileNavLastModified}`}
        role='cell'
        size='xs'
        title={item.last_modified}
        truncate
      >
        {getProjectFileModifiedLabel(item.last_modified)}
      </Text>
      <Text
        className={`${classes.fileNavMetadata} ${classes.fileNavType}`}
        role='cell'
        size='xs'
        truncate
      >
        {getProjectFileType(item)}
      </Text>

      {isFolder ? (
        <Box
          aria-label='No actions available'
          className={classes.fileNavActions}
          role='cell'
        />
      ) : (
        <Group
          className={classes.fileNavActions}
          gap={2}
          role='cell'
          wrap='nowrap'
        >
          <Tooltip label='Download file'>
            <ActionIcon
              aria-label='Download file'
              color='gray'
              disabled={isDeleting || isConfirmingDelete || isSubmittingRename}
              size='sm'
              variant='subtle'
              onClick={onDownload}
              onDoubleClick={stopRowDoubleClick}
            >
              <IHubIconDownload size={14} />
            </ActionIcon>
          </Tooltip>
          {isEditingRename ? (
            <>
              <Tooltip label='Rename file'>
                <ActionIcon
                  aria-label='Confirm rename'
                  color='blue'
                  loading={isSubmittingRename}
                  size='sm'
                  variant='subtle'
                  onClick={onConfirmRename}
                  onDoubleClick={stopRowDoubleClick}
                >
                  <IHubIconCheck size={14} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label='Cancel rename'>
                <ActionIcon
                  aria-label='Cancel rename'
                  disabled={isSubmittingRename}
                  size='sm'
                  variant='subtle'
                  onClick={onCancelRename}
                  onDoubleClick={stopRowDoubleClick}
                >
                  <IHubIconX size={14} />
                </ActionIcon>
              </Tooltip>
            </>
          ) : isConfirmingDelete ? (
            <>
              <Tooltip label='Delete file'>
                <ActionIcon
                  aria-label='Delete file'
                  color='red'
                  loading={isDeleting}
                  size='sm'
                  variant='subtle'
                  onClick={onConfirmDelete}
                  onDoubleClick={stopRowDoubleClick}
                >
                  <IHubIconCheck size={14} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label='Cancel delete'>
                <ActionIcon
                  aria-label='Cancel delete'
                  disabled={isDeleting}
                  size='sm'
                  variant='subtle'
                  onClick={onCancelDelete}
                  onDoubleClick={stopRowDoubleClick}
                >
                  <IHubIconX size={14} />
                </ActionIcon>
              </Tooltip>
            </>
          ) : (
            <>
              {canRename && (
                <Tooltip label={renameDisabledReason ?? 'Rename file'}>
                  <span>
                    <ActionIcon
                      aria-label='Rename file'
                      color='gray'
                      disabled={
                        isDeleting ||
                        renameActionsDisabled ||
                        renameDisabledReason !== null
                      }
                      size='sm'
                      variant='subtle'
                      onClick={onRequestRename}
                      onDoubleClick={stopRowDoubleClick}
                    >
                      <IHubIconEdit size={14} />
                    </ActionIcon>
                  </span>
                </Tooltip>
              )}
              <Tooltip label='Delete file'>
                <ActionIcon
                  aria-label='Delete file'
                  color='gray'
                  disabled={isDeleting}
                  size='sm'
                  variant='subtle'
                  onClick={onRequestDelete}
                  onDoubleClick={stopRowDoubleClick}
                >
                  <IHubIconTrash size={14} />
                </ActionIcon>
              </Tooltip>
            </>
          )}
        </Group>
      )}
    </Box>
  )
}

/**
 * Parses the Jupyter user segment from a server URL.
 */
function getJupyterUserFromServerUrl(serverUrl: string) {
  const match = serverUrl.match(/\/user\/([^/]+)/)

  if (!match?.[1]) {
    return null
  }

  return decodeURIComponent(match[1])
}
