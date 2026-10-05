import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import type { Project } from '@ihub/utils/types/project'
import type { JupyterServerConfig } from '@ihub/utils/types/notebook'
import type { User } from '@ihub/utils/types/types'

import {
  closeTabsForDeletedProjectFileState,
  renameProjectFileTabsState,
  type CloseProjectFileTabsResult,
  type RenameProjectFileTabsResult,
} from '../hooks/tab-state.ts'
import type { ThemeSchemeId } from '../theme/colorSchemes.ts'
import type { CampaignViewport, NavLink, Tab } from '../types.ts'

/* -------------------------- Navigation Atoms ---------------------- */

/**
 * Holds the currently selected item in the left navigation.
 * `null` means no option is currently active.
 */
export const activeNavOptionAtom = atom<NavLink | null>(null)

/**
 * Stores all open editor tabs in the order they appear in the UI.
 */
export const openTabsAtom = atom<Tab[]>([])
/**
 * Tracks the tab currently focused in the editor.
 * `null` means there is no active tab.
 */
export const activeTabAtom = atom<Tab | null>(null)
/**
 * Updates the in-memory Campaign Builder sheet selection for one open tab.
 * Unknown tab ids are ignored so stale campaign views cannot affect a newly
 * activated tab during route transitions.
 */
export const setTabCampaignSheetAtom = atom<
  null,
  [tabId: number | string, sheetId: string],
  void
>(null, (get, set, tabId, sheetId) => {
  const openTabs = get(openTabsAtom)
  const matchingTabIndex = openTabs.findIndex((tab) => tab.id === tabId)

  if (matchingTabIndex === -1) {
    return
  }

  const matchingTab = openTabs[matchingTabIndex]!
  const updatedTab = {
    ...matchingTab,
    selectedCampaignSheetId: sheetId,
  }
  const updatedTabs = [...openTabs]
  updatedTabs[matchingTabIndex] = updatedTab
  set(openTabsAtom, updatedTabs)

  if (get(activeTabAtom)?.id === tabId) {
    set(activeTabAtom, updatedTab)
  }
})
/**
 * Stores one Campaign Builder sheet viewport in transient open-tab state.
 * Unknown tab ids are ignored so stale campaign views cannot mutate a tab
 * that has already been closed.
 */
export const setTabCampaignViewportAtom = atom<
  null,
  [tabId: number | string, sheetId: string, viewport: CampaignViewport],
  void
>(null, (get, set, tabId, sheetId, viewport) => {
  const openTabs = get(openTabsAtom)
  const matchingTabIndex = openTabs.findIndex((tab) => tab.id === tabId)

  if (matchingTabIndex === -1) {
    return
  }

  const matchingTab = openTabs[matchingTabIndex]!
  const updatedTab = {
    ...matchingTab,
    campaignSheetViewports: {
      ...matchingTab.campaignSheetViewports,
      [sheetId]: viewport,
    },
  }
  const updatedTabs = [...openTabs]
  updatedTabs[matchingTabIndex] = updatedTab
  set(openTabsAtom, updatedTabs)

  if (get(activeTabAtom)?.id === tabId) {
    set(activeTabAtom, updatedTab)
  }
})
/**
 * Counts how many tabs have been created during this browser session.
 * Useful for generating stable tab labels/ids in UI flows.
 */
export const numTabsCreatedAtom = atom<number>(0)
/**
 * Write-only atom that closes any open tabs mapped to a deleted project file.
 *
 * Arguments:
 * - `projectId`: owning project id
 * - `contentPath`: deleted file path
 *
 * Returns a structured result describing whether tabs were closed and whether
 * the active tab changed.
 */
export const closeTabsForDeletedProjectFileAtom = atom<
  null,
  [projectId: string, contentPath: string],
  CloseProjectFileTabsResult
>(null, (get, set, projectId, contentPath) => {
  const latestOpenTabs = get(openTabsAtom)
  const latestActiveTab = get(activeTabAtom)
  const result = closeTabsForDeletedProjectFileState(
    latestOpenTabs,
    latestActiveTab,
    projectId,
    contentPath,
  )

  if (!result.tabsWereClosed) {
    return result
  }

  set(openTabsAtom, result.updatedTabs)

  if (result.activeTabWasClosed) {
    set(activeTabAtom, result.nextActiveTab ?? null)
  }

  return result
})
/**
 * Write-only atom that renames matching open tabs when a file is renamed or
 * moved, including the active tab when it matches.
 *
 * Arguments:
 * - `projectId`: owning project id
 * - `oldContentPath`: previous file path
 * - `newContentPath`: new file path
 * - `newFilename`: new display filename
 */
export const renameProjectFileTabsAtom = atom<
  null,
  [
    projectId: string,
    oldContentPath: string,
    newContentPath: string,
    newFilename: string,
  ],
  RenameProjectFileTabsResult
>(null, (get, set, projectId, oldContentPath, newContentPath, newFilename) => {
  const result = renameProjectFileTabsState(
    get(openTabsAtom),
    get(activeTabAtom),
    projectId,
    oldContentPath,
    newContentPath,
    newFilename,
  )

  if (result.tabsWereRenamed) {
    set(openTabsAtom, result.updatedTabs)
  }
  if (result.renamedActiveTab) {
    set(activeTabAtom, result.renamedActiveTab)
  }

  return result
})
/**
 * Write-only variant of file-tab rename that updates inactive tabs only.
 * The active tab is intentionally left unchanged by this operation.
 */
export const renameInactiveProjectFileTabsAtom = atom<
  null,
  [
    projectId: string,
    oldContentPath: string,
    newContentPath: string,
    newFilename: string,
  ],
  RenameProjectFileTabsResult
>(null, (get, set, projectId, oldContentPath, newContentPath, newFilename) => {
  const result = renameProjectFileTabsState(
    get(openTabsAtom),
    get(activeTabAtom),
    projectId,
    oldContentPath,
    newContentPath,
    newFilename,
    false,
  )

  if (result.tabsWereRenamed) {
    set(openTabsAtom, result.updatedTabs)
  }

  return result
})

/**
 * Tracks the most recent notebook auto-save timestamp for UI status displays.
 * `undefined` means no auto-save has been recorded yet.
 */
export const lastAutoSaveTimeNotebookAtom = atom<string | undefined>(undefined)

/* -------------------------- Jupyter Atoms ------------------------- */

/**
 * Stores available Jupyter server configurations known to the current session.
 */
export const jupyterServersAtom = atom<JupyterServerConfig[]>([])

/**
 * Holds the currently selected project id across global hub state.
 */
export const selectedProjectIdAtom = atom<string | undefined>(undefined)

/**
 * Stores the current logged-in user profile used by hub UI components.
 */
export const loggedInUserAtom = atom<User>({
  id: 'test_user_00',
  firstName: 'Albert',
  lastName: 'Einstein',
  email: 'albert.einstein@example.com',
  profilePictureUrl: '',
})

/**
 * Contains the loaded project list.
 * `null` represents "not loaded yet".
 */
export const listOfProjectsAtom = atom<Project[] | null>(null)

/**
 * Registry of MCP clients keyed by client id for quick lookups and routing.
 */
export const mcpClientsDictAtom = atom<Record<string, unknown>>({})

/**
 * Persisted theme preference.
 * Saved in local storage as `ihub-theme-scheme` and restored on reload.
 */
export const themeSchemeAtom = atomWithStorage<ThemeSchemeId>(
  'ihub-theme-scheme',
  'current-light',
)
