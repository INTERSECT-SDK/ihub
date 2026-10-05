import { atom } from 'jotai'

import { normalizeProjectFileServerIdentity } from '../app/project/project-file-coordination.ts'

export const OPEN_PROJECT_FILE_SAVE_ERROR =
  'Unable to save open changes. The file was not renamed.'
export const OPEN_PROJECT_FILE_BUSY_ERROR =
  'Wait for background activity to finish before renaming this file.'

export type ProjectFileEditorRenamePreparation =
  | { status: 'busy' }
  | {
      status: 'prepared'
      registrationId: symbol
      isCurrent: () => boolean
      release: () => void
      restore: () => Promise<void>
    }

export type ActiveProjectFileNavigationEditorHandle = {
  prepareNavigation: () => Promise<boolean>
}

export type ActiveProjectFileEditorHandle = {
  registrationId: symbol
  serverIdentity: string
  projectId: string
  contentPath: string
  isBusy: () => boolean
  prepareRename: () => Promise<boolean>
  pauseSharedLock: () => Promise<void>
  resumeSharedLock: () => Promise<void>
  releaseRename: () => void
}

export const activeProjectFileNavigationEditorAtom =
  atom<ActiveProjectFileNavigationEditorHandle | null>(null)

export const activeProjectFileEditorAtom =
  atom<ActiveProjectFileEditorHandle | null>(null)

/** Prepare the currently mounted editor when it owns the rename source path. */
export const prepareActiveProjectFileRenameAtom = atom<
  null,
  [serverIdentity: string, projectId: string, contentPath: string],
  Promise<ProjectFileEditorRenamePreparation | null>
>(null, async (get, _set, serverIdentity, projectId, contentPath) => {
  const editor = get(activeProjectFileEditorAtom)
  if (
    !editor ||
    editor.serverIdentity !==
      normalizeProjectFileServerIdentity(serverIdentity) ||
    editor.projectId !== projectId ||
    editor.contentPath !== contentPath
  ) {
    return null
  }

  if (editor.isBusy() || !(await editor.prepareRename())) {
    return { status: 'busy' }
  }

  try {
    await editor.pauseSharedLock()
  } catch (error) {
    editor.releaseRename()
    throw error
  }

  let settled = false
  return {
    status: 'prepared',
    registrationId: editor.registrationId,
    isCurrent: () =>
      get(activeProjectFileEditorAtom)?.registrationId ===
      editor.registrationId,
    release: () => {
      if (settled) {
        return
      }

      settled = true
      editor.releaseRename()
    },
    restore: async () => {
      if (settled) {
        return
      }

      settled = true
      try {
        await editor.resumeSharedLock()
      } finally {
        editor.releaseRename()
      }
    },
  }
})
