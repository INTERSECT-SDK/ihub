import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { usePathname, useRouter } from 'next/navigation'
import {
  activeTabAtom,
  closeTabsForDeletedProjectFileAtom,
  numTabsCreatedAtom,
  openTabsAtom,
  renameInactiveProjectFileTabsAtom,
  renameProjectFileTabsAtom,
} from '@/atoms/global'
import { NewTab, Tab } from '@/types'
import {
  guardedTabTransitionAtom,
  isTabTransitionPendingAtom,
} from '@/atoms/tab-transition.ts'

/**
 * Hook to control tabs in the TabsBar component.
 */
export default function useTabs() {
  const router = useRouter()
  const pathname = usePathname()
  const [numTabsCreated, setNumTabsCreated] = useAtom(numTabsCreatedAtom)
  const [openTabs, setOpenTabs] = useAtom(openTabsAtom)
  const setActiveTab = useSetAtom(activeTabAtom)
  const closeDeletedProjectFileTabs = useSetAtom(
    closeTabsForDeletedProjectFileAtom,
  )
  const renameProjectFileTabs = useSetAtom(renameProjectFileTabsAtom)
  const renameInactiveProjectFileTabs = useSetAtom(
    renameInactiveProjectFileTabsAtom,
  )
  const runGuardedTabTransition = useSetAtom(guardedTabTransitionAtom)
  const isTabTransitionPending = useAtomValue(isTabTransitionPendingAtom)

  /**
   * Add a new tab to the Tabs Bar.
   * @param id - Tab ID. If not explicity given the new total number of tabs becomes the ID.
   * @param title - Name that appears in the tab.
   * @param name - Internal name used by application. Optional.
   * @param view - React component user sees when tab is active. Default is a blank view.
   * @param icon - Icon that appears in the tab. Default is the file icon.
   */
  function addTab({ id, title, path, name, icon }: NewTab) {
    const newTotalTabs = numTabsCreated + 1
    // the new tab info
    const newTab: Tab = {
      id: id || newTotalTabs,
      title,
      path,
      name,
      // view,
      icon,
    }

    setOpenTabs([...openTabs, newTab])
    setNumTabsCreated(newTotalTabs)
    setActiveTab(newTab)
  }

  function closeTabsForDeletedProjectFile(
    projectId: string,
    contentPath: string,
  ) {
    return closeDeletedProjectFileTabs(projectId, contentPath)
  }

  /**
   * Renames every open tab that points to the specified project file path.
   * This keeps tab metadata in sync after a project file is renamed.
   * @param projectId - Project identifier that scopes the tab update.
   * @param oldContentPath - Original file path currently referenced by tabs.
   * @param newContentPath - New file path that should replace the old one.
   * @param newFilename - Display name shown on updated tabs.
   */
  function renameTabsForProjectFile(
    projectId: string,
    oldContentPath: string,
    newContentPath: string,
    newFilename: string,
  ) {
    return renameProjectFileTabs(
      projectId,
      oldContentPath,
      newContentPath,
      newFilename,
    )
  }

  function activateTab(tab: Tab): Promise<boolean> {
    return runGuardedTabTransition({
      type: 'activate',
      tab,
      currentPathname: pathname,
      router,
    })
  }

  function addAndActivateTab(
    tab: NewTab,
    destinationPath?: string,
  ): Promise<boolean> {
    return runGuardedTabTransition({
      type: 'add-and-activate',
      tab,
      destinationPath,
      router,
    })
  }

  function replaceAndActivateTab(
    tabId: number | string,
    tab: Tab,
    destinationPath?: string,
  ): Promise<boolean> {
    return runGuardedTabTransition({
      type: 'replace-and-activate',
      tabId,
      tab,
      destinationPath,
      router,
    })
  }

  function closeActiveTabAndNavigate(
    tabId: number | string,
    fallbackLauncherTab: NewTab,
  ): Promise<boolean> {
    return runGuardedTabTransition({
      type: 'close-active-and-navigate',
      tabId,
      fallbackLauncherTab,
      router,
    })
  }

  return {
    openTabs,
    addTab,
    closeTabsForDeletedProjectFile,
    renameInactiveProjectFileTabs,
    renameTabsForProjectFile,
    activateTab,
    addAndActivateTab,
    replaceAndActivateTab,
    closeActiveTabAndNavigate,
    isTabTransitionPending,
  }
}
