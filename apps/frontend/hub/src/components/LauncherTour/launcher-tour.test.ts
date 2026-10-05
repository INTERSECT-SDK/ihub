import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Tab } from '@/types.ts'

import {
  getLauncherTabSelection,
  getLauncherTourMarkerKey,
  isLauncherRoute,
  isLauncherTourAutoEligible,
  isLauncherTourTerminalEvent,
  readLauncherTourMarker,
  reserveLauncherTourAutoStart,
  waitForLauncherTourTargets,
  type LauncherTourTargetScheduler,
  writeLauncherTourMarker,
  type TourStorage,
} from './launcher-tour.ts'

class MemoryStorage implements TourStorage {
  readonly values = new Map<string, string>()
  failReads = false
  failWrites = false
  failedSetKey: string | undefined

  getItem(key: string): string | null {
    if (this.failReads) throw new Error('read failed')
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    if (this.failWrites || key === this.failedSetKey) {
      throw new Error('write failed')
    }
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    if (this.failWrites) throw new Error('remove failed')
    this.values.delete(key)
  }
}

class ManualScheduler implements LauncherTourTargetScheduler {
  readonly cancelledFrames: number[] = []
  readonly clearedTimeouts: number[] = []
  readonly frames = new Map<number, () => void>()
  readonly timers = new Map<number, () => void>()
  private nextId = 1

  cancelAnimationFrame(frameId: number): void {
    this.cancelledFrames.push(frameId)
    this.frames.delete(frameId)
  }

  clearTimeout(timeoutId: number): void {
    this.clearedTimeouts.push(timeoutId)
    this.timers.delete(timeoutId)
  }

  requestAnimationFrame(callback: () => void): number {
    const id = this.nextId++
    this.frames.set(id, callback)
    return id
  }

  setTimeout(callback: () => void): number {
    const id = this.nextId++
    this.timers.set(id, callback)
    return id
  }

  takeFrame(): () => void {
    const entry = this.frames.entries().next().value
    assert.ok(entry)
    const [id, callback] = entry
    this.frames.delete(id)
    return callback
  }

  takeTimer(): () => void {
    const entry = this.timers.entries().next().value
    assert.ok(entry)
    const [id, callback] = entry
    this.timers.delete(id)
    return callback
  }
}

test('constructs an encoded marker scoped to the exact user id', () => {
  assert.equal(
    getLauncherTourMarkerKey('user/name@example.com'),
    'ihub:launcher-tour:auto-started:v1:user%2Fname%40example.com',
  )
  assert.notEqual(
    getLauncherTourMarkerKey('user-a'),
    getLauncherTourMarkerKey('user-b'),
  )
})

test('storage failures suppress automatic startup but not marker writes', () => {
  const storage = new MemoryStorage()
  storage.failReads = true
  assert.deepEqual(readLauncherTourMarker(storage, 'marker'), {
    available: false,
    started: false,
  })

  storage.failReads = false
  storage.failWrites = true
  assert.deepEqual(readLauncherTourMarker(storage, 'marker'), {
    available: false,
    started: false,
  })
  assert.equal(writeLauncherTourMarker(storage, 'marker'), false)
})

test('automatic eligibility requires authentication, route, storage, and targets', () => {
  const eligible = {
    authenticated: true,
    exactLauncherRoute: true,
    markerAvailable: true,
    markerStarted: false,
    targetsReady: true,
  }

  assert.equal(isLauncherTourAutoEligible(eligible), true)
  for (const blocked of [
    { ...eligible, authenticated: false },
    { ...eligible, exactLauncherRoute: false },
    { ...eligible, markerAvailable: false },
    { ...eligible, markerStarted: true },
    { ...eligible, targetsReady: false },
  ]) {
    assert.equal(isLauncherTourAutoEligible(blocked), false)
  }
})

test('automatic startup reservation is synchronous and single-use', () => {
  const storage = new MemoryStorage()
  const eligibility = {
    authenticated: true,
    exactLauncherRoute: true,
    targetsReady: true,
  }

  assert.equal(
    reserveLauncherTourAutoStart(storage, 'marker', eligibility),
    true,
  )
  assert.equal(storage.getItem('marker'), '1')
  assert.equal(
    reserveLauncherTourAutoStart(storage, 'marker', eligibility),
    false,
  )
})

test('failed marker writes suppress automatic startup', () => {
  const storage = new MemoryStorage()
  storage.failedSetKey = 'marker'

  assert.equal(
    reserveLauncherTourAutoStart(storage, 'marker', {
      authenticated: true,
      exactLauncherRoute: true,
      targetsReady: true,
    }),
    false,
  )
  assert.equal(storage.getItem('marker'), null)
})

test('target waiter resolves when targets become ready and cleans up', async () => {
  const scheduler = new ManualScheduler()
  const abortController = new AbortController()
  let ready = false
  let readinessChecks = 0
  const result = waitForLauncherTourTargets({
    signal: abortController.signal,
    targetsReady: () => {
      readinessChecks += 1
      return ready
    },
    timeoutMs: 15_000,
    scheduler,
  })

  assert.equal(readinessChecks, 1)
  ready = true
  scheduler.takeFrame()()

  assert.equal(await result, true)
  assert.equal(readinessChecks, 2)
  assert.equal(scheduler.frames.size, 0)
  assert.equal(scheduler.timers.size, 0)
  assert.equal(scheduler.clearedTimeouts.length, 1)
})

test('target waiter times out once and cannot poll after cleanup', async () => {
  const scheduler = new ManualScheduler()
  let readinessChecks = 0
  const result = waitForLauncherTourTargets({
    signal: new AbortController().signal,
    targetsReady: () => {
      readinessChecks += 1
      return false
    },
    timeoutMs: 15_000,
    scheduler,
  })
  const staleFrame = scheduler.takeFrame()

  scheduler.takeTimer()()

  assert.equal(await result, false)
  assert.equal(scheduler.cancelledFrames.length, 1)
  assert.equal(scheduler.frames.size, 0)
  assert.equal(scheduler.timers.size, 0)
  staleFrame()
  assert.equal(readinessChecks, 1)
  assert.equal(scheduler.frames.size, 0)
})

test('target waiter aborts and cancels pending polling and timeout', async () => {
  const scheduler = new ManualScheduler()
  const abortController = new AbortController()
  let readinessChecks = 0
  const result = waitForLauncherTourTargets({
    signal: abortController.signal,
    targetsReady: () => {
      readinessChecks += 1
      return false
    },
    timeoutMs: 15_000,
    scheduler,
  })
  const staleTimer = scheduler.takeTimer()

  abortController.abort()

  assert.equal(await result, false)
  assert.equal(scheduler.cancelledFrames.length, 1)
  assert.equal(scheduler.clearedTimeouts.length, 1)
  assert.equal(scheduler.frames.size, 0)
  staleTimer()
  assert.equal(readinessChecks, 1)
  assert.equal(scheduler.frames.size, 0)
})

test('finish, skip, close, and target failure are terminal', () => {
  for (const event of [
    { action: 'next', status: 'finished', type: 'tour:end' },
    { action: 'skip', status: 'skipped', type: 'tour:end' },
    { action: 'close', status: 'running', type: 'step:after' },
    {
      action: 'update',
      status: 'running',
      type: 'error:target_not_found',
    },
  ]) {
    assert.equal(isLauncherTourTerminalEvent(event), true)
  }
  assert.equal(
    isLauncherTourTerminalEvent({
      action: 'next',
      status: 'running',
      type: 'tooltip',
    }),
    false,
  )
})

test('recognizes only the exact launcher route with optional base path', () => {
  assert.equal(isLauncherRoute('/project/project-a', 'project-a'), true)
  assert.equal(isLauncherRoute('/hub/project/project-a/', 'project-a'), true)
  assert.equal(
    isLauncherRoute('/project/project-a/document.icmp', 'project-a'),
    false,
  )
  assert.equal(isLauncherRoute('/project/project-b', 'project-a'), false)
})

test('selects an existing launcher tab without changing document tabs', () => {
  const tabs: Tab[] = [
    { id: 'doc', title: 'Document', path: '/project/a/file.icmp' },
    {
      id: 'launcher',
      title: 'Launcher',
      path: '/project/a',
      name: 'launcher',
    },
  ]

  const result = getLauncherTabSelection(tabs, 'a', 'new')
  assert.equal(result.isNew, false)
  assert.equal(result.tab, tabs[1])
  assert.equal(tabs.length, 2)
})

test('creates launcher tab metadata when the current project has none', () => {
  assert.deepEqual(
    getLauncherTabSelection(
      [{ id: 'doc', title: 'Document', path: '/project/a/file.icmp' }],
      'a',
      'new-launcher',
    ),
    {
      isNew: true,
      tab: {
        id: 'new-launcher',
        title: 'Launcher',
        path: '/project/a',
        name: 'launcher',
      },
    },
  )
})
