/**
 * Utilities and types for tracking project editor documents, including
 * document keys, load state, autosave eligibility, and dirty content updates.
 */
import type { JupyterServerConfig } from '@ihub/utils/types/notebook'

export type EditorDocument = {
  type?: string
  content: unknown
  [key: string]: unknown
}

export type LoadedDocument = {
  key: string
  document: EditorDocument
  dirty: boolean
}

export type LoadError = {
  key: string
  message: string
}

export type AutosaveFailure = {
  key: string
  document: EditorDocument
  message: string
}

export type DocumentSaveAttempt = {
  id: number
  key: string
  document: EditorDocument
}

export type DocumentContentUpdateOptions = {
  dirty?: boolean
}

export type ParseLoadedDocumentContentOptions = {
  preserveStringContent?: boolean
}

export type FlushDocumentBeforeRenameOptions = {
  currentDocumentKey: string
  getLatestDocument: () => LoadedDocument | undefined
  getInFlightSave: () => Promise<void> | null
  saveDocument: (document: LoadedDocument) => Promise<void>
}

export function normalizeHttpBaseUrl(rawUrl?: string): string | null {
  if (!rawUrl) {
    return null
  }

  try {
    const trimmedUrl = rawUrl.trim()

    if (trimmedUrl.startsWith('/')) {
      return trimmedUrl.replace(/\/$/, '')
    }

    const withProtocol = /^https?:\/\//i.test(trimmedUrl)
      ? trimmedUrl
      : `http://${trimmedUrl}`
    return new URL(withProtocol).toString().replace(/\/$/, '')
  } catch (error) {
    console.error('Invalid Jupyter server URL:', rawUrl, error)
    return null
  }
}

export function buildDocumentKey({
  projectId,
  filePath,
  jupyterServer,
  jupyterServerBaseUrl,
}: {
  projectId: string
  filePath: string
  jupyterServer?: Pick<JupyterServerConfig, 'id' | 'url'> | null
  jupyterServerBaseUrl: string | null
}): string | null {
  if (!jupyterServer || !jupyterServerBaseUrl) {
    return null
  }

  const rawServerId =
    jupyterServer.id === undefined || jupyterServer.id === null
      ? ''
      : String(jupyterServer.id).trim()
  const serverId = rawServerId || 'unknown-jupyter-server'

  return `${serverId}@${jupyterServerBaseUrl}::${projectId}/${filePath}`
}

export function getActiveLoadedDocument(
  loadedDocument: LoadedDocument | undefined,
  currentDocumentKey: string | null,
): LoadedDocument | undefined {
  return loadedDocument?.key === currentDocumentKey ? loadedDocument : undefined
}

export function shouldAutosaveDocument({
  loadedDocument,
  currentDocumentKey,
  jupyterServer,
  jupyterServerBaseUrl,
  activeLoadError,
}: {
  loadedDocument: LoadedDocument | undefined
  currentDocumentKey: string | null
  jupyterServer?: JupyterServerConfig | null
  jupyterServerBaseUrl: string | null
  activeLoadError: string | null
}): boolean {
  return Boolean(
    jupyterServer &&
    jupyterServerBaseUrl &&
    !activeLoadError &&
    loadedDocument?.key === currentDocumentKey &&
    loadedDocument.dirty,
  )
}

/**
 * Prevents an unchanged failed snapshot from entering an automatic retry loop.
 * A content edit creates a new editor-document object and is eligible to save.
 */
export function shouldAttemptAutomaticSave(
  loadedDocument: LoadedDocument,
  failure: AutosaveFailure | null,
): boolean {
  return !(
    failure?.key === loadedDocument.key &&
    failure.document === loadedDocument.document
  )
}

/** Returns whether a completion still owns the newest save for this document. */
export function ownsLatestSaveCompletion({
  attempt,
  latestAttemptId,
  currentDocumentKey,
}: {
  attempt: DocumentSaveAttempt
  latestAttemptId: number
  currentDocumentKey: string | null
}): boolean {
  return attempt.id === latestAttemptId && attempt.key === currentDocumentKey
}

/**
 * Returns whether the newest save also persisted the current content snapshot.
 */
export function savedLatestDocumentSnapshot({
  attempt,
  latestAttemptId,
  currentDocument,
}: {
  attempt: DocumentSaveAttempt
  latestAttemptId: number
  currentDocument: LoadedDocument | undefined
}): boolean {
  return (
    ownsLatestSaveCompletion({
      attempt,
      latestAttemptId,
      currentDocumentKey: currentDocument?.key ?? null,
    }) && currentDocument?.document === attempt.document
  )
}

export function applyDocumentContentUpdate(
  currentDocument: LoadedDocument | undefined,
  currentDocumentKey: string | null,
  content: unknown,
  options: DocumentContentUpdateOptions = {},
): LoadedDocument | undefined {
  if (currentDocument?.key !== currentDocumentKey) {
    return currentDocument
  }

  return {
    key: currentDocument.key,
    dirty: options.dirty === false ? currentDocument.dirty : true,
    document: {
      ...currentDocument.document,
      content,
    },
  }
}

export function markDocumentCleanAfterSave(
  currentDocument: LoadedDocument | undefined,
  savedDocument: LoadedDocument,
): LoadedDocument | undefined {
  if (
    currentDocument?.key !== savedDocument.key ||
    currentDocument.document !== savedDocument.document
  ) {
    return currentDocument
  }

  return {
    ...currentDocument,
    dirty: false,
  }
}

export function preserveDirtyAfterFailedSave(
  currentDocument: LoadedDocument | undefined,
  savedDocument: LoadedDocument,
): LoadedDocument | undefined {
  if (
    currentDocument?.key !== savedDocument.key ||
    currentDocument.document !== savedDocument.document
  ) {
    return currentDocument
  }

  return {
    ...currentDocument,
    dirty: true,
  }
}

/**
 * Waits for an existing save and then persists every newer dirty snapshot
 * before an operation that requires a clean active document begins.
 */
export async function flushDocumentSaveBarrier({
  currentDocumentKey,
  getLatestDocument,
  getInFlightSave,
  saveDocument,
}: FlushDocumentBeforeRenameOptions): Promise<void> {
  const inFlightSave = getInFlightSave()
  if (inFlightSave) {
    await inFlightSave
  }

  while (true) {
    const latestDocument = getActiveLoadedDocument(
      getLatestDocument(),
      currentDocumentKey,
    )
    if (!latestDocument?.dirty) {
      return
    }

    await saveDocument(latestDocument)

    if (getLatestDocument() === latestDocument) {
      throw new Error('Document remained dirty after a successful save.')
    }
  }
}

export async function assertSuccessfulSaveResponse(
  response: Response,
): Promise<void> {
  if (response.ok) {
    return
  }

  let responseText = ''
  try {
    responseText = await response.text()
  } catch {
    responseText = ''
  }

  const statusText = response.statusText ? ` ${response.statusText}` : ''
  const responseDetails = responseText ? ` ${responseText}` : ''
  throw new DocumentSaveResponseError(
    `Failed to save document: ${response.status}${statusText}${responseDetails}`,
    response.status,
  )
}

export class DocumentSaveResponseError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'DocumentSaveResponseError'
    this.status = status
  }
}

/** Converts save errors into concise, user-safe alert text. */
export function getDocumentSaveFailureMessage(error: unknown): string {
  if (error instanceof DocumentSaveResponseError && error.status === 413) {
    return 'This document is too large to save. Reduce its size and retry.'
  }

  return 'Your latest changes could not be saved. Retry when ready.'
}

export function parseLoadedDocumentContent(
  document: EditorDocument,
  options: ParseLoadedDocumentContentOptions = {},
): EditorDocument {
  if (options.preserveStringContent || typeof document.content !== 'string') {
    return document
  }

  try {
    return {
      ...document,
      content: JSON.parse(document.content) as unknown,
    }
  } catch {
    return document
  }
}

function stringifyDisplayContent(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }

  if (content === null || content === undefined) {
    return ''
  }

  try {
    const serializedContent = JSON.stringify(content, null, 2)
    return serializedContent ?? String(content)
  } catch {
    return String(content)
  }
}

export function getNormalizedFileExtension(filename: string): string {
  const lastDotIndex = filename.lastIndexOf('.')
  return lastDotIndex !== -1
    ? filename.substring(lastDotIndex + 1).toLowerCase()
    : ''
}

export function normalizeTextFileContent(content: unknown): string {
  return stringifyDisplayContent(content)
}

export function normalizeJsonFileContent(content: unknown): string {
  if (typeof content === 'string') {
    try {
      const parsedContent = JSON.parse(content) as unknown
      return JSON.stringify(parsedContent, null, 2) ?? ''
    } catch {
      return content
    }
  }

  return stringifyDisplayContent(content)
}
