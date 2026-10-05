import assert from 'node:assert/strict'
import test from 'node:test'

import { createStore } from 'jotai/vanilla'

import { activeTabAtom, numTabsCreatedAtom, openTabsAtom } from './global.ts'
import { activeProjectFileNavigationEditorAtom } from './project-file-editor.ts'
import {
  guardedTabTransitionAtom,
  isTabTransitionPendingAtom,
} from './tab-transition.ts'
import type { Tab } from '../types.ts'

const first: Tab = {
  id: 'first',
  title: 'First',
  path: '/project/a/first.icmp',
}
const second: Tab = {
  id: 'second',
  title: 'Second',
  path: '/project/a/second.icmp',
  selectedCampaignSheetId: 'second-group',
}

function createRouter() {
  const pushes: string[] = []
  return { pushes, router: { push: (path: string) => pushes.push(path) } }
}

function registerEditor(
  store: ReturnType<typeof createStore>,
  prepare: () => Promise<boolean>,
) {
  store.set(activeProjectFileNavigationEditorAtom, {
    prepareNavigation: prepare,
  })
}

test('saves before mutating tab state or URL', async () => {
  const store = createStore()
  const { pushes, router } = createRouter()
  let releaseSave: () => void = () => undefined
  const save = new Promise<void>((resolve) => {
    releaseSave = resolve
  })
  registerEditor(store, async () => {
    await save
    return true
  })
  store.set(openTabsAtom, [first, second])
  store.set(activeTabAtom, first)

  const transition = store.set(guardedTabTransitionAtom, {
    type: 'activate',
    tab: second,
    currentPathname: first.path,
    router,
  })

  assert.equal(store.get(isTabTransitionPendingAtom), true)
  assert.equal(store.get(activeTabAtom), first)
  assert.deepEqual(pushes, [])
  releaseSave()
  assert.equal(await transition, true)
  assert.equal(store.get(activeTabAtom), second)
  assert.equal(
    store.get(activeTabAtom)?.selectedCampaignSheetId,
    'second-group',
  )
  assert.deepEqual(pushes, [second.path])
})

test('failed preparation preserves tabs and URL', async () => {
  const store = createStore()
  const { pushes, router } = createRouter()
  registerEditor(store, async () => {
    throw new Error('save failed')
  })
  store.set(openTabsAtom, [first, second])
  store.set(activeTabAtom, first)

  assert.equal(
    await store.set(guardedTabTransitionAtom, {
      type: 'activate',
      tab: second,
      currentPathname: first.path,
      router,
    }),
    false,
  )
  assert.deepEqual(store.get(openTabsAtom), [first, second])
  assert.equal(store.get(activeTabAtom), first)
  assert.deepEqual(pushes, [])
})

test('busy preparation preserves navigation state and a later retry succeeds', async () => {
  const store = createStore()
  const { pushes, router } = createRouter()
  let busy = true
  registerEditor(store, async () => !busy)
  store.set(openTabsAtom, [first, second])
  store.set(activeTabAtom, first)

  const transition = {
    type: 'activate' as const,
    tab: second,
    currentPathname: first.path,
    router,
  }

  assert.equal(await store.set(guardedTabTransitionAtom, transition), false)
  assert.deepEqual(store.get(openTabsAtom), [first, second])
  assert.equal(store.get(activeTabAtom), first)
  assert.equal(store.get(isTabTransitionPendingAtom), false)
  assert.deepEqual(pushes, [])

  busy = false
  assert.equal(await store.set(guardedTabTransitionAtom, transition), true)
  assert.deepEqual(store.get(openTabsAtom), [first, second])
  assert.equal(store.get(activeTabAtom), second)
  assert.equal(store.get(isTabTransitionPendingAtom), false)
  assert.deepEqual(pushes, [second.path])
})

test('simultaneous requests allow only one save and navigation', async () => {
  const store = createStore()
  const { pushes, router } = createRouter()
  let prepareCalls = 0
  let releaseSave: () => void = () => undefined
  const save = new Promise<void>((resolve) => {
    releaseSave = resolve
  })
  registerEditor(store, async () => {
    prepareCalls += 1
    await save
    return true
  })
  store.set(openTabsAtom, [first, second])
  store.set(activeTabAtom, first)

  const firstRequest = store.set(guardedTabTransitionAtom, {
    type: 'activate',
    tab: second,
    currentPathname: first.path,
    router,
  })
  const duplicateRequest = store.set(guardedTabTransitionAtom, {
    type: 'add-and-activate',
    tab: { title: 'Third', path: '/project/a/third.icmp' },
    router,
  })
  assert.equal(await duplicateRequest, false)
  releaseSave()
  assert.equal(await firstRequest, true)
  assert.equal(prepareCalls, 1)
  assert.deepEqual(pushes, [second.path])
})

test('uses the latest tab and counter state after saving', async () => {
  const store = createStore()
  const { router } = createRouter()
  let releaseSave: () => void = () => undefined
  registerEditor(store, async () => {
    await new Promise<void>((resolve) => {
      releaseSave = resolve
    })
    return true
  })
  store.set(openTabsAtom, [first])
  store.set(activeTabAtom, first)
  store.set(numTabsCreatedAtom, 4)

  const transition = store.set(guardedTabTransitionAtom, {
    type: 'add-and-activate',
    tab: { title: 'Added', path: '/project/a/added.icmp' },
    router,
  })
  store.set(openTabsAtom, [first, second])
  store.set(numTabsCreatedAtom, 8)
  releaseSave()

  assert.equal(await transition, true)
  assert.deepEqual(
    store.get(openTabsAtom).map((tab) => tab.id),
    ['first', 'second', 9],
  )
  assert.equal(store.get(numTabsCreatedAtom), 9)
})

test('same-tab selection on the current route and inactive close skip preparation', async () => {
  const store = createStore()
  const { pushes, router } = createRouter()
  let prepareCalls = 0
  registerEditor(store, async () => {
    prepareCalls += 1
    return true
  })
  store.set(openTabsAtom, [first, second])
  store.set(activeTabAtom, first)

  assert.equal(
    await store.set(guardedTabTransitionAtom, {
      type: 'activate',
      tab: first,
      currentPathname: `/hub${first.path}/`,
      router,
    }),
    true,
  )
  assert.equal(
    await store.set(guardedTabTransitionAtom, {
      type: 'close-active-and-navigate',
      tabId: second.id,
      fallbackLauncherTab: {
        title: 'Launcher',
        path: '/project/a',
      },
      router,
    }),
    true,
  )
  assert.equal(prepareCalls, 0)
  assert.deepEqual(store.get(openTabsAtom), [first])
  assert.deepEqual(pushes, [])
})

test('same-tab selection on a different route saves and repairs the URL', async () => {
  const store = createStore()
  const { pushes, router } = createRouter()
  let prepareCalls = 0
  registerEditor(store, async () => {
    prepareCalls += 1
    return true
  })
  store.set(openTabsAtom, [first, second])
  store.set(activeTabAtom, first)

  assert.equal(
    await store.set(guardedTabTransitionAtom, {
      type: 'activate',
      tab: first,
      currentPathname: '/project/a',
      router,
    }),
    true,
  )
  assert.equal(prepareCalls, 1)
  assert.equal(store.get(activeTabAtom), first)
  assert.deepEqual(pushes, [first.path])
})

test('failed same-tab route repair preserves tab state and URL', async () => {
  const store = createStore()
  const { pushes, router } = createRouter()
  registerEditor(store, async () => {
    throw new Error('save failed')
  })
  store.set(openTabsAtom, [first, second])
  store.set(activeTabAtom, first)

  assert.equal(
    await store.set(guardedTabTransitionAtom, {
      type: 'activate',
      tab: first,
      currentPathname: '/project/a',
      router,
    }),
    false,
  )
  assert.deepEqual(store.get(openTabsAtom), [first, second])
  assert.equal(store.get(activeTabAtom), first)
  assert.deepEqual(pushes, [])
})

test('active close selects a neighbor or atomically installs Launcher fallback', async () => {
  const store = createStore()
  const { pushes, router } = createRouter()
  store.set(openTabsAtom, [first, second])
  store.set(activeTabAtom, second)

  assert.equal(
    await store.set(guardedTabTransitionAtom, {
      type: 'close-active-and-navigate',
      tabId: second.id,
      fallbackLauncherTab: { title: 'Launcher', path: '/project/a' },
      router,
    }),
    true,
  )
  assert.equal(store.get(activeTabAtom), first)

  assert.equal(
    await store.set(guardedTabTransitionAtom, {
      type: 'close-active-and-navigate',
      tabId: first.id,
      fallbackLauncherTab: {
        title: 'Launcher',
        path: '/project/a',
        name: 'launcher',
      },
      router,
    }),
    true,
  )
  assert.deepEqual(store.get(openTabsAtom), [
    {
      id: 1,
      title: 'Launcher',
      path: '/project/a',
      name: 'launcher',
      icon: undefined,
    },
  ])
  assert.deepEqual(pushes, [first.path, '/project/a'])
})
