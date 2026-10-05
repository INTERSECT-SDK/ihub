import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createStore } from 'jotai/vanilla'

import {
  activeTabAtom,
  closeTabsForDeletedProjectFileAtom,
  openTabsAtom,
  renameProjectFileTabsAtom,
} from '../atoms/global.ts'
import {
  closeTabState,
  closeTabsForDeletedProjectFileState,
  getFileTabTitle,
  getInitialProjectTab,
  getProjectFileTabRoute,
  getProjectFileRouteAfterRename,
  normalizeApplicationRoute,
  normalizeTabRoute,
  renameProjectFileTabsState,
  tabMatchesProjectFile,
  tabRouteMatchesPathname,
} from './tab-state.ts'
import type { Tab } from '../types.ts'

const tabs: Tab[] = [
  {
    id: 'first',
    title: 'First',
    path: '/project/a/first.icmp',
  },
  {
    id: 'middle',
    title: 'Middle',
    path: '/project/a/middle.icmp',
  },
  {
    id: 'last',
    title: 'Last',
    path: '/project/a/last.icmp',
  },
]

test('initializes a direct nested project-file route as the active tab', () => {
  assert.deepEqual(
    getInitialProjectTab(
      '/hub/project/project-id/nested%20folder/notebook%20one.ipynb',
      'project-id',
    ),
    {
      id: '/project/project-id/nested%20folder/notebook%20one.ipynb',
      title: 'notebook one',
      name: 'projects/project-id/nested folder/notebook one.ipynb',
      path: '/project/project-id/nested%20folder/notebook%20one.ipynb',
    },
  )
})

test('initializes the project root as the launcher tab', () => {
  assert.deepEqual(getInitialProjectTab('/project/project-id', 'project-id'), {
    title: 'Launcher',
    path: '/project/project-id',
    name: 'launcher',
  })
})

test('closing a middle tab selects the immediate left tab', () => {
  const result = closeTabState(tabs, tabs[1], 'middle')

  assert.deepEqual(
    result.updatedTabs.map((tab) => tab.id),
    ['first', 'last'],
  )
  assert.equal(result.activeTabWasClosed, true)
  assert.equal(result.nextActiveTab?.id, 'first')
})

test('closing the last tab selects the new last tab', () => {
  const result = closeTabState(tabs, tabs[2], 'last')

  assert.deepEqual(
    result.updatedTabs.map((tab) => tab.id),
    ['first', 'middle'],
  )
  assert.equal(result.activeTabWasClosed, true)
  assert.equal(result.nextActiveTab?.id, 'middle')
})

test('closing the first tab selects the new first tab', () => {
  const result = closeTabState(tabs, tabs[0], 'first')

  assert.deepEqual(
    result.updatedTabs.map((tab) => tab.id),
    ['middle', 'last'],
  )
  assert.equal(result.activeTabWasClosed, true)
  assert.equal(result.nextActiveTab?.id, 'middle')
})

test('closing a non-active tab leaves the active tab unchanged', () => {
  const result = closeTabState(tabs, tabs[0], 'middle')

  assert.equal(result.tabWasClosed, true)
  assert.equal(result.activeTabWasClosed, false)
  assert.deepEqual(
    result.updatedTabs.map((tab) => tab.id),
    ['first', 'last'],
  )
  assert.equal(result.nextActiveTab, undefined)
})

test('closing the only tab yields no next active tab', () => {
  const result = closeTabState([tabs[0]], tabs[0], 'first')

  assert.equal(result.tabWasClosed, true)
  assert.equal(result.activeTabWasClosed, true)
  assert.deepEqual(result.updatedTabs, [])
  assert.equal(result.nextActiveTab, undefined)
})

test('closing an unknown tab does not change tabs', () => {
  const result = closeTabState(tabs, tabs[0], 'unknown')

  assert.equal(result.tabWasClosed, false)
  assert.equal(result.activeTabWasClosed, false)
  assert.deepEqual(result.updatedTabs, tabs)
  assert.equal(result.nextActiveTab, undefined)
})

test('route normalization preserves absolute paths and prefixes bare paths', () => {
  assert.equal(
    normalizeTabRoute('/project/a/file.icmp'),
    '/project/a/file.icmp',
  )
  assert.equal(normalizeTabRoute('project/a/file.icmp'), '/project/a/file.icmp')
})

test('application route normalization removes the Hub base path and trailing slashes', () => {
  assert.equal(
    normalizeApplicationRoute('/hub/project/a/file.icmp/'),
    '/project/a/file.icmp',
  )
  assert.equal(
    normalizeApplicationRoute('/project/a/file.icmp'),
    '/project/a/file.icmp',
  )
  assert.equal(normalizeApplicationRoute('/hub/'), '/')
})

test('tab route matching requires the exact normalized application route', () => {
  assert.equal(
    tabRouteMatchesPathname(
      '/project/a/file.icmp',
      '/hub/project/a/file.icmp/',
    ),
    true,
  )
  assert.equal(
    tabRouteMatchesPathname('/project/a/file.icmp', '/project/a'),
    false,
  )
  assert.equal(
    tabRouteMatchesPathname('/project/a/file.icmp', '/project/a/file.icmp/x'),
    false,
  )
})

test('text and JSON tab titles keep the full file name', () => {
  assert.equal(getFileTabTitle('notes.txt'), 'notes.txt')
  assert.equal(getFileTabTitle('settings.json'), 'settings.json')
  assert.equal(getFileTabTitle('README.TXT'), 'README.TXT')
})

test('existing file tab titles still omit the extension', () => {
  assert.equal(getFileTabTitle('campaign.icmp'), 'campaign')
  assert.equal(getFileTabTitle('analysis.ipynb'), 'analysis')
})

test('project content path maps to the matching project file tab route', () => {
  assert.equal(
    getProjectFileTabRoute('project-a', 'projects/project-a/folder/file.icmp'),
    '/project/project-a/folder/file.icmp',
  )
})

test('project file routes encode every logical path segment canonically', () => {
  assert.equal(
    getProjectFileTabRoute(
      'project-a',
      'projects/project-a/folder #1/query? 100%/文 件.json',
    ),
    '/project/project-a/folder%20%231/query%3F%20100%25/%E6%96%87%20%E4%BB%B6.json',
  )
})

test('project content path outside the selected project has no tab route', () => {
  assert.equal(
    getProjectFileTabRoute('project-a', 'projects/project-b/folder/file.icmp'),
    null,
  )
  assert.equal(getProjectFileTabRoute('project-a', 'projects/project-a'), null)
})

test('project file matcher identifies the active tab route', () => {
  assert.equal(
    tabMatchesProjectFile(
      {
        id: 'active',
        title: 'File',
        path: 'project/project-a/folder/file.icmp',
      },
      'project-a',
      'projects/project-a/folder/file.icmp',
    ),
    true,
  )
})

test('project file matcher uses the encoded canonical nested route', () => {
  assert.equal(
    tabMatchesProjectFile(
      {
        id: 'active',
        title: 'Reserved',
        path: '/project/project-a/folder%20%231/query%3F%20100%25/%E6%96%87.json',
      },
      'project-a',
      'projects/project-a/folder #1/query? 100%/文.json',
    ),
    true,
  )
})

test('project file matcher rejects other tabs and directories', () => {
  assert.equal(
    tabMatchesProjectFile(
      tabs[0],
      'project-a',
      'projects/project-a/folder/file.icmp',
    ),
    false,
  )
  assert.equal(
    tabMatchesProjectFile(null, 'project-a', 'projects/project-a'),
    false,
  )
})

test('active project-file rename navigates to the canonical target route', () => {
  assert.equal(
    getProjectFileRouteAfterRename(
      'project-a',
      'projects/project-a/renamed.icmp',
      {
        activeTabWasRenamed: true,
        preparedEditorFreshness: 'not-prepared',
      },
    ),
    '/project/project-a/renamed.icmp',
  )
})

test('prepared editor rename does not navigate after the user switches tabs', () => {
  assert.equal(
    getProjectFileRouteAfterRename(
      'project-a',
      'projects/project-a/folder #1/renamed 文.json',
      {
        activeTabWasRenamed: false,
        preparedEditorFreshness: 'current',
      },
    ),
    undefined,
  )
})

test('inactive project-file rename does not change the current route', () => {
  assert.equal(
    getProjectFileRouteAfterRename(
      'project-a',
      'projects/project-a/renamed.icmp',
      {
        activeTabWasRenamed: false,
        preparedEditorFreshness: 'not-prepared',
      },
    ),
    undefined,
  )
})

test('stale prepared editor prevents rename navigation', () => {
  assert.equal(
    getProjectFileRouteAfterRename(
      'project-a',
      'projects/project-a/renamed.icmp',
      {
        activeTabWasRenamed: true,
        preparedEditorFreshness: 'stale',
      },
    ),
    undefined,
  )
})

test('renaming an inactive project file retargets its tab metadata', () => {
  const result = renameProjectFileTabsState(
    tabs,
    tabs[0],
    'a',
    'projects/a/middle.icmp',
    'projects/a/renamed.icmp',
    'renamed.icmp',
  )

  assert.equal(result.tabsWereRenamed, true)
  assert.equal(result.activeTabWasRenamed, false)
  assert.deepEqual(result.updatedTabs[1], {
    ...tabs[1],
    path: '/project/a/renamed.icmp',
    title: 'renamed',
    name: 'projects/a/renamed.icmp',
  })
  assert.equal(result.updatedTabs[0], tabs[0])
  assert.equal(result.updatedTabs[2], tabs[2])
})

test('renaming the active project file preserves its identity and selection', () => {
  const tabsWithCampaignSelection = tabs.map((tab) =>
    tab.id === 'middle'
      ? { ...tab, selectedCampaignSheetId: 'middle-group' }
      : tab,
  )
  const result = renameProjectFileTabsState(
    tabsWithCampaignSelection,
    tabsWithCampaignSelection[1],
    'a',
    'projects/a/middle.icmp',
    'projects/a/renamed.icmp',
    'renamed.icmp',
  )

  assert.equal(result.activeTabWasRenamed, true)
  assert.equal(result.renamedActiveTab?.id, 'middle')
  assert.equal(result.renamedActiveTab?.path, '/project/a/renamed.icmp')
  assert.equal(result.renamedActiveTab?.selectedCampaignSheetId, 'middle-group')
  assert.equal(result.renamedRoute, '/project/a/renamed.icmp')
  assert.deepEqual(
    result.updatedTabs.map((tab) => tab.id),
    ['first', 'middle', 'last'],
  )
})

test('remote rename leaves the active matching tab unchanged', () => {
  const result = renameProjectFileTabsState(
    tabs,
    tabs[1],
    'a',
    'projects/a/middle.icmp',
    'projects/a/renamed.icmp',
    'renamed.icmp',
    false,
  )

  assert.equal(result.tabsWereRenamed, false)
  assert.equal(result.activeTabWasRenamed, false)
  assert.equal(result.updatedTabs, tabs)
})

test('renaming updates duplicate canonical tabs with reserved path segments', () => {
  const duplicateTabs: Tab[] = [
    {
      id: 'first-reserved',
      title: 'Old',
      path: '/project/a/folder%20%231/old%20file.json',
    },
    {
      id: 'second-reserved',
      title: 'Old',
      path: 'project/a/folder%20%231/old%20file.json',
    },
  ]
  const result = renameProjectFileTabsState(
    duplicateTabs,
    duplicateTabs[0],
    'a',
    'projects/a/folder #1/old file.json',
    'projects/a/folder #1/renamed 文.json',
    'renamed 文.json',
  )

  assert.equal(result.tabsWereRenamed, true)
  assert.deepEqual(
    result.updatedTabs.map((tab) => tab.path),
    [
      '/project/a/folder%20%231/renamed%20%E6%96%87.json',
      '/project/a/folder%20%231/renamed%20%E6%96%87.json',
    ],
  )
  assert.deepEqual(
    result.updatedTabs.map((tab) => tab.title),
    ['renamed 文.json', 'renamed 文.json'],
  )
})

test('renaming a path outside the selected project leaves tabs unchanged', () => {
  const result = renameProjectFileTabsState(
    tabs,
    tabs[1],
    'b',
    'projects/a/middle.icmp',
    'projects/a/renamed.icmp',
    'renamed.icmp',
  )

  assert.equal(result.tabsWereRenamed, false)
  assert.equal(result.activeTabWasRenamed, false)
  assert.equal(result.updatedTabs, tabs)
})

test('deleting a project file closes a matching non-active tab', () => {
  const result = closeTabsForDeletedProjectFileState(
    tabs,
    tabs[0],
    'a',
    'projects/a/middle.icmp',
  )

  assert.equal(result.tabsWereClosed, true)
  assert.equal(result.activeTabWasClosed, false)
  assert.deepEqual(
    result.updatedTabs.map((tab) => tab.id),
    ['first', 'last'],
  )
  assert.equal(result.nextActiveTab, undefined)
})

test('deleting the active project file selects the nearest remaining tab', () => {
  const result = closeTabsForDeletedProjectFileState(
    tabs,
    tabs[1],
    'a',
    'projects/a/middle.icmp',
  )

  assert.equal(result.tabsWereClosed, true)
  assert.equal(result.activeTabWasClosed, true)
  assert.deepEqual(
    result.updatedTabs.map((tab) => tab.id),
    ['first', 'last'],
  )
  assert.equal(result.nextActiveTab?.id, 'first')
})

test('deleting the only matching active project file has no next active tab', () => {
  const result = closeTabsForDeletedProjectFileState(
    [tabs[1]],
    tabs[1],
    'a',
    'projects/a/middle.icmp',
  )

  assert.equal(result.tabsWereClosed, true)
  assert.equal(result.activeTabWasClosed, true)
  assert.deepEqual(result.updatedTabs, [])
  assert.equal(result.nextActiveTab, undefined)
})

test('deleting a project file closes duplicate tabs for the same route', () => {
  const duplicateTabs: Tab[] = [
    tabs[0],
    tabs[1],
    {
      id: 'duplicate-middle',
      title: 'Middle',
      path: 'project/a/middle.icmp',
    },
    tabs[2],
  ]

  const result = closeTabsForDeletedProjectFileState(
    duplicateTabs,
    tabs[1],
    'a',
    'projects/a/middle.icmp',
  )

  assert.equal(result.tabsWereClosed, true)
  assert.equal(result.activeTabWasClosed, true)
  assert.deepEqual(
    result.updatedTabs.map((tab) => tab.id),
    ['first', 'last'],
  )
  assert.equal(result.nextActiveTab?.id, 'first')
})

test('deleting a reserved-character nested file closes its canonical tab', () => {
  const reservedTab: Tab = {
    id: 'reserved',
    title: 'Reserved',
    path: '/project/a/folder%20%231/query%3F%20100%25/%E6%96%87.json',
  }
  const result = closeTabsForDeletedProjectFileState(
    [tabs[0], reservedTab],
    reservedTab,
    'a',
    'projects/a/folder #1/query? 100%/文.json',
  )

  assert.equal(result.tabsWereClosed, true)
  assert.equal(result.activeTabWasClosed, true)
  assert.deepEqual(result.updatedTabs, [tabs[0]])
  assert.equal(result.nextActiveTab?.id, 'first')
})

test('deleting a path outside the current project does not change tabs', () => {
  const result = closeTabsForDeletedProjectFileState(
    tabs,
    tabs[1],
    'b',
    'projects/a/middle.icmp',
  )

  assert.equal(result.tabsWereClosed, false)
  assert.equal(result.activeTabWasClosed, false)
  assert.deepEqual(result.updatedTabs, tabs)
  assert.equal(result.nextActiveTab, undefined)
})

test('deleted project file cleanup reads the latest open tabs from the store', () => {
  const store = createStore()
  const initialTabs = [tabs[0], tabs[1]]

  store.set(openTabsAtom, initialTabs)
  store.set(activeTabAtom, tabs[0])
  store.set(openTabsAtom, [...initialTabs, tabs[2]])

  const result = store.set(
    closeTabsForDeletedProjectFileAtom,
    'a',
    'projects/a/middle.icmp',
  )

  assert.equal(result.tabsWereClosed, true)
  assert.equal(result.activeTabWasClosed, false)
  assert.deepEqual(
    store.get(openTabsAtom).map((tab) => tab.id),
    ['first', 'last'],
  )
  assert.equal(store.get(activeTabAtom)?.id, 'first')
})

test('deleted active project file cleanup updates active tab from latest state', () => {
  const store = createStore()

  store.set(openTabsAtom, tabs)
  store.set(activeTabAtom, tabs[1])

  const result = store.set(
    closeTabsForDeletedProjectFileAtom,
    'a',
    'projects/a/middle.icmp',
  )

  assert.equal(result.tabsWereClosed, true)
  assert.equal(result.activeTabWasClosed, true)
  assert.deepEqual(
    store.get(openTabsAtom).map((tab) => tab.id),
    ['first', 'last'],
  )
  assert.equal(result.nextActiveTab?.id, 'first')
  assert.equal(store.get(activeTabAtom)?.id, 'first')
})

test('renamed project file tabs are computed from the latest store state', () => {
  const store = createStore()
  const initialTabs = [tabs[0], tabs[1]]

  store.set(openTabsAtom, initialTabs)
  store.set(activeTabAtom, tabs[1])
  store.set(openTabsAtom, [...initialTabs, tabs[2]])

  const result = store.set(
    renameProjectFileTabsAtom,
    'a',
    'projects/a/middle.icmp',
    'projects/a/renamed.icmp',
    'renamed.icmp',
  )

  assert.equal(result.activeTabWasRenamed, true)
  assert.deepEqual(
    store.get(openTabsAtom).map((tab) => tab.id),
    ['first', 'middle', 'last'],
  )
  assert.equal(store.get(openTabsAtom)[1].path, '/project/a/renamed.icmp')
  assert.equal(store.get(activeTabAtom)?.path, '/project/a/renamed.icmp')
})
