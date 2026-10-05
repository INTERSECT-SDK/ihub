/**
 * State machine types, actions, validation logic, and helper utilities for
 * renaming project files in the side navigation bar. Covers the full rename
 * lifecycle — idle → editing → submitting → success/failure — and provides
 * utilities for reconciling optimistic UI updates with server responses and
 * for recovering from failed or ambiguous rename operations.
 * @module
 */

import type { ContentFile } from '@ihub/utils/types/types'

import { encodePathSegments } from '../../app/project/project-file-path.ts'
import type { ProjectFileRenamePublicationResult } from '../../app/project/project-file-coordination.ts'

export type ProjectFileRenameState =
  | { status: 'idle' }
  | {
      status: 'editing' | 'submitting'
      itemPath: string
      originalName: string
      value: string
      error: string | null
    }

export type ProjectFileRenameAction =
  | { type: 'start'; itemPath: string; originalName: string }
  | { type: 'change'; value: string }
  | { type: 'submit' }
  | { type: 'fail'; error: string }
  | { type: 'cancel' | 'succeed' }

export type ProjectFileRenameValidation =
  | { kind: 'valid'; filename: string; targetPath: string }
  | { kind: 'unchanged' }
  | { kind: 'invalid'; message: string }

export type FailedProjectFileRenameRefreshState =
  | { kind: 'unavailable' }
  | { kind: 'source-present' }
  | { kind: 'target-present' }
  | { kind: 'ambiguous' }

export const initialProjectFileRenameState: ProjectFileRenameState = {
  status: 'idle',
}

/**
 * A prepared editor can resume without navigation only when old-path saves
 * will resolve through a persisted rename mapping. Navigating keeps the editor
 * paused until the old route unmounts.
 */
export function shouldReleasePreparedEditorAfterCommittedRename(
  publicationResult: ProjectFileRenamePublicationResult | null,
  didNavigate: boolean,
): boolean {
  return !didNavigate && publicationResult?.persistentMappingSucceeded === true
}

/** Apply a successful rename response while keeping the validated name canonical. */
export function buildRenamedProjectFile(
  item: ContentFile,
  renamedModel: Partial<ContentFile>,
  filename: string,
  targetPath: string,
): ContentFile {
  return {
    ...item,
    ...renamedModel,
    name: filename,
    path: targetPath,
  }
}

/** Keep inline rename interactions in a small, testable state machine. */
export function projectFileRenameReducer(
  state: ProjectFileRenameState,
  action: ProjectFileRenameAction,
): ProjectFileRenameState {
  switch (action.type) {
    case 'start':
      if (state.status === 'submitting') {
        return state
      }

      return {
        status: 'editing',
        itemPath: action.itemPath,
        originalName: action.originalName,
        value: getProjectFileRenameEditableName(action.originalName),
        error: null,
      }
    case 'change':
      return state.status === 'editing'
        ? { ...state, value: action.value, error: null }
        : state
    case 'submit':
      return state.status === 'editing'
        ? { ...state, status: 'submitting', error: null }
        : state
    case 'fail':
      return state.status === 'idle'
        ? state
        : { ...state, status: 'editing', error: action.error }
    case 'cancel':
      return state.status === 'submitting'
        ? state
        : initialProjectFileRenameState
    case 'succeed':
      return initialProjectFileRenameState
  }
}

/**
 * Inspects a refreshed directory listing after a failed rename request.
 * A missing source indicates that the backend may have completed a partial
 * rename even though it returned an error.
 */
export function inspectFailedProjectFileRenameRefresh(
  items: readonly Pick<ContentFile, 'path'>[] | undefined,
  sourcePath: string,
  targetPath: string,
): FailedProjectFileRenameRefreshState {
  if (!items) {
    return { kind: 'unavailable' }
  }

  const sourcePresent = items.some((item) => item.path === sourcePath)
  const targetPresent = items.some((item) => item.path === targetPath)

  if (sourcePresent && !targetPresent) {
    return { kind: 'source-present' }
  }

  if (!sourcePresent && targetPresent) {
    return { kind: 'target-present' }
  }

  return { kind: 'ambiguous' }
}

/** Return whether the current directory already contains the exact target path. */
export function hasProjectFileRenameDuplicate(
  items: readonly Pick<ContentFile, 'path'>[],
  targetPath: string,
): boolean {
  return items.some((item) => item.path === targetPath)
}

/** Return whether a navigator item exposes the rename action. */
export function canRenameProjectFile(
  item: Pick<ContentFile, 'type' | 'writable'>,
  accessLevel?: 'view' | 'edit',
): boolean {
  return accessLevel === 'edit' && item.type !== 'directory' && item.writable
}

/** Validate a same-directory filename change and construct its target path. */
export function validateProjectFileRename(
  originalPath: string,
  originalName: string,
  value: string,
): ProjectFileRenameValidation {
  const editableName = value.trim()
  if (!editableName) {
    return { kind: 'invalid', message: 'Enter a filename.' }
  }

  if (
    editableName === '.' ||
    editableName === '..' ||
    editableName.includes('/') ||
    editableName.includes('\\') ||
    editableName.includes('\0')
  ) {
    return {
      kind: 'invalid',
      message: 'Enter a filename without path separators or dot segments.',
    }
  }

  const filename = `${editableName}${getProjectFileRenameExtension(originalName)}`

  if (filename === originalName) {
    return { kind: 'unchanged' }
  }

  return {
    kind: 'valid',
    filename,
    targetPath: buildProjectFileRenameTargetPath(originalPath, filename),
  }
}

/** Return the editable filename portion without its final extension. */
export function getProjectFileRenameEditableName(filename: string): string {
  const extensionIndex = filename.lastIndexOf('.')
  return extensionIndex > 0 ? filename.slice(0, extensionIndex) : filename
}

/** Return the fixed final extension displayed beside the rename input. */
export function getProjectFileRenameExtension(filename: string): string {
  const extensionIndex = filename.lastIndexOf('.')
  return extensionIndex > 0 ? filename.slice(extensionIndex) : ''
}

/** Replace only the final filename segment of a project contents path. */
export function buildProjectFileRenameTargetPath(
  originalPath: string,
  filename: string,
): string {
  const separatorIndex = originalPath.lastIndexOf('/')
  return separatorIndex === -1
    ? filename
    : `${originalPath.slice(0, separatorIndex)}/${filename}`
}

/** Build the authenticated backend proxy URL for a rename request. */
export function buildProjectFileRenameUrl(
  oldPath: string,
  jupyterUser: string,
  jupyterServerUrl: string,
): string {
  const params = new URLSearchParams({
    jupyter_user: jupyterUser,
    jupyter_server_url: jupyterServerUrl,
  })

  return `/api/v1/contents/rename/${encodePathSegments(oldPath)}?${params.toString()}`
}
