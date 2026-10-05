import type { NewTab, Tab } from '../types.ts'
import { buildProjectFileRoute } from '../app/project/project-file-path.ts'

export type CloseTabResult = {
  tabWasClosed: boolean
  updatedTabs: Tab[]
  activeTabWasClosed: boolean
  nextActiveTab?: Tab
}

export type CloseProjectFileTabsResult = {
  tabsWereClosed: boolean
  updatedTabs: Tab[]
  activeTabWasClosed: boolean
  nextActiveTab?: Tab
}

export type RenameProjectFileTabsResult = {
  tabsWereRenamed: boolean
  updatedTabs: Tab[]
  activeTabWasRenamed: boolean
  renamedActiveTab?: Tab
  renamedRoute?: string
}

export type PreparedEditorFreshness = 'not-prepared' | 'current' | 'stale'

/**
 * Computes the tab list after closing a tab and identifies the replacement
 * active tab. If the requested tab is not open, the original state is returned
 * unchanged and `tabWasClosed` is false.
 *
 * @param openTabs - The currently open tabs, in display order.
 * @param idToRemove - The id of the tab to close.
 * @returns The updated tab list, whether a tab was closed, and the next active
 * tab when one remains.
 */
export function closeTabState(
  openTabs: Tab[],
  activeTab: Tab | null,
  idToRemove: number | string,
): CloseTabResult {
  const indexRemoved = openTabs.findIndex((tab) => tab.id === idToRemove)

  if (indexRemoved === -1) {
    return {
      tabWasClosed: false,
      updatedTabs: openTabs,
      activeTabWasClosed: false,
    }
  }

  const updatedTabs = openTabs.filter((tab) => tab.id !== idToRemove)
  const activeTabWasClosed = activeTab?.id === idToRemove

  if (!activeTabWasClosed || updatedTabs.length === 0) {
    return {
      tabWasClosed: true,
      updatedTabs,
      activeTabWasClosed,
    }
  }

  const nextActiveTab =
    indexRemoved === 0 ? updatedTabs[0] : updatedTabs[indexRemoved - 1]

  return {
    tabWasClosed: true,
    updatedTabs,
    activeTabWasClosed: true,
    nextActiveTab,
  }
}

export function normalizeTabRoute(path: string): string {
  return path.startsWith('/') ? path : `/${path}`
}

/** Normalize a browser or tab route for exact in-app route comparisons. */
export function normalizeApplicationRoute(path: string): string {
  const normalizedPath = normalizeTabRoute(path)
  const withoutBasePath =
    normalizedPath === '/hub'
      ? '/'
      : normalizedPath.startsWith('/hub/')
        ? normalizedPath.slice('/hub'.length)
        : normalizedPath

  return withoutBasePath.length > 1
    ? withoutBasePath.replace(/\/+$/, '')
    : withoutBasePath
}

/** Return whether a tab points to the browser's exact current app route. */
export function tabRouteMatchesPathname(
  tabRoute: string,
  pathname: string,
): boolean {
  return (
    normalizeApplicationRoute(tabRoute) === normalizeApplicationRoute(pathname)
  )
}

export function getFileTabTitle(fileName: string): string {
  const lowerFileName = fileName.toLowerCase()

  if (lowerFileName.endsWith('.txt') || lowerFileName.endsWith('.json')) {
    return fileName
  }

  return fileName.split('.').slice(0, -1).join('.')
}

function decodeRouteSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

/**
 * Build the first in-memory tab from the protected route being restored.
 */
export function getInitialProjectTab(
  pathname: string,
  projectId: string,
): NewTab {
  const projectRoute = `/project/${projectId}`
  const normalizedPathname = normalizeTabRoute(pathname)
  const projectRouteIndex = normalizedPathname.indexOf(projectRoute)
  const applicationPathname =
    projectRouteIndex >= 0
      ? normalizedPathname.slice(projectRouteIndex)
      : normalizedPathname
  const encodedFilePath = applicationPathname.startsWith(`${projectRoute}/`)
    ? applicationPathname.slice(projectRoute.length + 1)
    : ''

  if (encodedFilePath) {
    const decodedSegments = encodedFilePath.split('/').map(decodeRouteSegment)
    const fileName = decodedSegments.at(-1) || encodedFilePath

    return {
      id: applicationPathname,
      title: getFileTabTitle(fileName),
      name: `projects/${projectId}/${decodedSegments.join('/')}`,
      path: applicationPathname,
    }
  }

  return {
    title: 'Launcher',
    path: projectRoute,
    name: 'launcher',
  }
}

export function getProjectFileTabRoute(
  projectId: string,
  contentPath: string,
): string | null {
  const projectRoot = `projects/${projectId}/`

  if (!contentPath.startsWith(projectRoot)) {
    return null
  }

  const filePath = contentPath.slice(projectRoot.length)

  if (!filePath) {
    return null
  }

  return buildProjectFileRoute(projectId, filePath)
}

export function tabMatchesProjectFile(
  tab: Tab | null,
  projectId: string,
  contentPath: string,
): boolean {
  const projectFileRoute = getProjectFileTabRoute(projectId, contentPath)

  return (
    !!tab &&
    projectFileRoute !== null &&
    normalizeTabRoute(tab.path) === projectFileRoute
  )
}

/**
 * Returns the canonical route that should replace the current editor route
 * after a rename. Navigation requires the renamed tab to still be active, and
 * a stale prepared editor registration prevents redirecting a newer view.
 */
export function getProjectFileRouteAfterRename(
  projectId: string,
  newContentPath: string,
  {
    activeTabWasRenamed,
    preparedEditorFreshness,
  }: {
    activeTabWasRenamed: boolean
    preparedEditorFreshness: PreparedEditorFreshness
  },
): string | undefined {
  if (!activeTabWasRenamed || preparedEditorFreshness === 'stale') {
    return undefined
  }

  return getProjectFileTabRoute(projectId, newContentPath) ?? undefined
}

/**
 * Rewrites every tab that points to a renamed project file while preserving tab
 * identity and ordering.
 */
export function renameProjectFileTabsState(
  openTabs: Tab[],
  activeTab: Tab | null,
  projectId: string,
  oldContentPath: string,
  newContentPath: string,
  newFilename: string,
  includeActiveTab = true,
): RenameProjectFileTabsResult {
  const oldRoute = getProjectFileTabRoute(projectId, oldContentPath)
  const newRoute = getProjectFileTabRoute(projectId, newContentPath)

  if (!oldRoute || !newRoute) {
    return {
      tabsWereRenamed: false,
      updatedTabs: openTabs,
      activeTabWasRenamed: false,
    }
  }

  const matchesOldRoute = (tab: Tab) =>
    normalizeTabRoute(tab.path) === oldRoute &&
    (includeActiveTab || tab.id !== activeTab?.id)
  const renameTab = (tab: Tab): Tab => ({
    ...tab,
    path: newRoute,
    title: getFileTabTitle(newFilename),
    name: newContentPath,
  })
  const tabsWereRenamed = openTabs.some(matchesOldRoute)
  const updatedTabs = tabsWereRenamed
    ? openTabs.map((tab) => (matchesOldRoute(tab) ? renameTab(tab) : tab))
    : openTabs
  const activeTabWasRenamed = !!activeTab && matchesOldRoute(activeTab)
  const renamedActiveTab = activeTabWasRenamed
    ? (updatedTabs.find((tab) => tab.id === activeTab.id) ??
      renameTab(activeTab))
    : undefined

  return {
    tabsWereRenamed,
    updatedTabs,
    activeTabWasRenamed,
    renamedActiveTab,
    renamedRoute: activeTabWasRenamed ? newRoute : undefined,
  }
}

/**
 * Computes the tab state after a project file is deleted. Tabs matching the
 * deleted file route are removed, and when the active tab was one of those
 * tabs, the nearest remaining neighbor is selected as the next active tab.
 *
 * @param openTabs - The currently open tabs, in display order.
 * @param activeTab - The current active tab, if one is selected.
 * @param projectId - The project that owns the deleted file.
 * @param contentPath - The deleted file path, including the project root.
 * @returns The updated tab list, whether matching tabs were closed, whether the
 * active tab was closed, and the next active tab when one remains.
 */
export function closeTabsForDeletedProjectFileState(
  openTabs: Tab[],
  activeTab: Tab | null,
  projectId: string,
  contentPath: string,
): CloseProjectFileTabsResult {
  const deletedFileRoute = getProjectFileTabRoute(projectId, contentPath)

  if (!deletedFileRoute) {
    return {
      tabsWereClosed: false,
      updatedTabs: openTabs,
      activeTabWasClosed: false,
    }
  }

  const tabMatchesDeletedFile = (tab: Tab) =>
    normalizeTabRoute(tab.path) === deletedFileRoute
  const tabsWereClosed = openTabs.some(tabMatchesDeletedFile)

  if (!tabsWereClosed) {
    return {
      tabsWereClosed: false,
      updatedTabs: openTabs,
      activeTabWasClosed: false,
    }
  }

  const updatedTabs = openTabs.filter((tab) => !tabMatchesDeletedFile(tab))
  const activeTabWasClosed =
    !!activeTab && normalizeTabRoute(activeTab.path) === deletedFileRoute

  if (!activeTabWasClosed || updatedTabs.length === 0) {
    return {
      tabsWereClosed: true,
      updatedTabs,
      activeTabWasClosed,
    }
  }

  const activeTabIndex = openTabs.findIndex((tab) => tab.id === activeTab.id)
  const removedIndex =
    activeTabIndex === -1
      ? openTabs.findIndex(tabMatchesDeletedFile)
      : activeTabIndex
  const nextActiveTab =
    [...openTabs.slice(0, removedIndex)]
      .reverse()
      .find((tab) => !tabMatchesDeletedFile(tab)) ??
    openTabs.slice(removedIndex + 1).find((tab) => !tabMatchesDeletedFile(tab))

  return {
    tabsWereClosed: true,
    updatedTabs,
    activeTabWasClosed: true,
    nextActiveTab,
  }
}
