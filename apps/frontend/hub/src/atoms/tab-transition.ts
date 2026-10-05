import { atom } from 'jotai'

import { activeProjectFileNavigationEditorAtom } from './project-file-editor.ts'
import { activeTabAtom, numTabsCreatedAtom, openTabsAtom } from './global.ts'
import {
  closeTabState,
  normalizeTabRoute,
  tabRouteMatchesPathname,
} from '../hooks/tab-state.ts'
import type { NewTab, Tab } from '../types.ts'

export type TabTransitionRouter = {
  push: (path: string) => void
}

type TabTransition =
  | {
      type: 'activate'
      tab: Tab
      currentPathname: string
      router: TabTransitionRouter
    }
  | {
      type: 'add-and-activate'
      tab: NewTab
      destinationPath?: string
      router: TabTransitionRouter
    }
  | {
      type: 'replace-and-activate'
      tabId: number | string
      tab: Tab
      destinationPath?: string
      router: TabTransitionRouter
    }
  | {
      type: 'close-active-and-navigate'
      tabId: number | string
      fallbackLauncherTab: NewTab
      router: TabTransitionRouter
    }

export const isTabTransitionPendingAtom = atom(false)

function createTab(tab: NewTab, nextId: number): Tab {
  return {
    id: tab.id ?? nextId,
    title: tab.title,
    path: tab.path,
    name: tab.name,
    icon: tab.icon,
  }
}

/**
 * Serializes application-controlled tab transitions with the active editor's
 * save barrier. State is deliberately read again after preparation completes.
 */
export const guardedTabTransitionAtom = atom<
  null,
  [transition: TabTransition],
  Promise<boolean>
>(null, async (get, set, transition) => {
  const initialActiveTab = get(activeTabAtom)

  if (
    transition.type === 'activate' &&
    initialActiveTab?.id === transition.tab.id &&
    tabRouteMatchesPathname(transition.tab.path, transition.currentPathname)
  ) {
    return true
  }

  if (get(isTabTransitionPendingAtom)) {
    return false
  }

  if (transition.type === 'close-active-and-navigate') {
    const initialTabs = get(openTabsAtom)
    const initialClose = closeTabState(
      initialTabs,
      initialActiveTab,
      transition.tabId,
    )
    if (!initialClose.tabWasClosed) {
      return false
    }
    if (!initialClose.activeTabWasClosed) {
      set(openTabsAtom, initialClose.updatedTabs)
      return true
    }
  }

  set(isTabTransitionPendingAtom, true)
  try {
    const editor = get(activeProjectFileNavigationEditorAtom)
    if (editor && !(await editor.prepareNavigation())) {
      return false
    }

    if (transition.type === 'activate') {
      const destination = get(openTabsAtom).find(
        (tab) => tab.id === transition.tab.id,
      )
      if (!destination) {
        return false
      }
      set(activeTabAtom, destination)
      transition.router.push(normalizeTabRoute(destination.path))
      return true
    }

    if (transition.type === 'add-and-activate') {
      const nextCount = get(numTabsCreatedAtom) + 1
      const destination = createTab(transition.tab, nextCount)
      set(openTabsAtom, [...get(openTabsAtom), destination])
      set(numTabsCreatedAtom, nextCount)
      set(activeTabAtom, destination)
      transition.router.push(
        transition.destinationPath ?? normalizeTabRoute(destination.path),
      )
      return true
    }

    if (transition.type === 'replace-and-activate') {
      const latestTabs = get(openTabsAtom)
      const replacementIndex = latestTabs.findIndex(
        (tab) => tab.id === transition.tabId,
      )
      if (replacementIndex === -1) {
        return false
      }
      const updatedTabs = [...latestTabs]
      updatedTabs[replacementIndex] = transition.tab
      set(openTabsAtom, updatedTabs)
      set(activeTabAtom, transition.tab)
      transition.router.push(
        transition.destinationPath ?? normalizeTabRoute(transition.tab.path),
      )
      return true
    }

    const latestTabs = get(openTabsAtom)
    const latestActiveTab = get(activeTabAtom)
    const closeResult = closeTabState(
      latestTabs,
      latestActiveTab,
      transition.tabId,
    )
    if (!closeResult.tabWasClosed) {
      return false
    }
    if (!closeResult.activeTabWasClosed) {
      set(openTabsAtom, closeResult.updatedTabs)
      return true
    }

    if (closeResult.nextActiveTab) {
      set(openTabsAtom, closeResult.updatedTabs)
      set(activeTabAtom, closeResult.nextActiveTab)
      transition.router.push(normalizeTabRoute(closeResult.nextActiveTab.path))
      return true
    }

    const nextCount = get(numTabsCreatedAtom) + 1
    const fallback = createTab(transition.fallbackLauncherTab, nextCount)
    set(openTabsAtom, [fallback])
    set(numTabsCreatedAtom, nextCount)
    set(activeTabAtom, fallback)
    transition.router.push(normalizeTabRoute(fallback.path))
    return true
  } catch (error) {
    console.error('Tab transition blocked because the document save failed', {
      error,
    })
    return false
  } finally {
    set(isTabTransitionPendingAtom, false)
  }
})
