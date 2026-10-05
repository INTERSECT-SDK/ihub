import type { Tab } from '@/types.ts'

export const LAUNCHER_TOUR_TARGETS = [
  'launcher-create',
  'launcher',
  'nav-project-selection',
  'nav-project-activity',
  'nav-connections',
  'nav-utilities',
] as const

export const LAUNCHER_TOUR_TARGET_WAIT_MS = 15_000

const AUTO_STARTED_KEY_PREFIX = 'ihub:launcher-tour:auto-started:v1:'

export interface TourStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface LauncherTourTargetScheduler {
  cancelAnimationFrame(frameId: number): void
  clearTimeout(timeoutId: number): void
  requestAnimationFrame(callback: () => void): number
  setTimeout(callback: () => void, timeoutMs: number): number
}

export type TourEventSummary = {
  action: string
  status: string
  type: string
}

export type LauncherTabSelection = {
  isNew: boolean
  tab: Tab
}

/** Build the persistent, versioned marker for one authenticated user. */
export function getLauncherTourMarkerKey(userId: string): string {
  return `${AUTO_STARTED_KEY_PREFIX}${encodeURIComponent(userId)}`
}

/** Build the canonical launcher route for a project. */
export function getLauncherRoute(projectId: string): string {
  return `/project/${encodeURIComponent(projectId)}`
}

/** Recognize only the project launcher, not nested document routes. */
export function isLauncherRoute(pathname: string, projectId: string): boolean {
  const withoutBasePath = pathname.startsWith('/hub/')
    ? pathname.slice('/hub'.length)
    : pathname
  const normalizedPath =
    withoutBasePath.length > 1 && withoutBasePath.endsWith('/')
      ? withoutBasePath.slice(0, -1)
      : withoutBasePath

  return normalizedPath === getLauncherRoute(projectId)
}

/**
 * Read the user's marker only after confirming storage is both readable and
 * writable. Automatic startup is suppressed when either operation fails.
 */
export function readLauncherTourMarker(
  storage: TourStorage,
  markerKey: string,
): { available: boolean; started: boolean } {
  const probeKey = `${markerKey}:storage-probe`

  try {
    const previousProbe = storage.getItem(probeKey)
    storage.setItem(probeKey, previousProbe ?? '1')
    if (previousProbe === null) {
      storage.removeItem(probeKey)
    } else {
      storage.setItem(probeKey, previousProbe)
    }

    return {
      available: true,
      started: storage.getItem(markerKey) !== null,
    }
  } catch {
    return { available: false, started: false }
  }
}

/** Record a started tour without allowing storage failures to break replay. */
export function writeLauncherTourMarker(
  storage: TourStorage,
  markerKey: string,
): boolean {
  try {
    storage.setItem(markerKey, '1')
    return true
  } catch {
    return false
  }
}

/**
 * Claim automatic startup immediately before launch so concurrent mounts see
 * the marker before either tour can begin.
 */
export function reserveLauncherTourAutoStart(
  storage: TourStorage,
  markerKey: string,
  {
    authenticated,
    exactLauncherRoute,
    targetsReady,
  }: {
    authenticated: boolean
    exactLauncherRoute: boolean
    targetsReady: boolean
  },
): boolean {
  const marker = readLauncherTourMarker(storage, markerKey)

  if (
    !isLauncherTourAutoEligible({
      authenticated,
      exactLauncherRoute,
      markerAvailable: marker.available,
      markerStarted: marker.started,
      targetsReady,
    })
  ) {
    return false
  }

  return writeLauncherTourMarker(storage, markerKey)
}

/** Poll for launcher targets until they are ready, aborted, or time out. */
export function waitForLauncherTourTargets({
  signal,
  targetsReady,
  timeoutMs,
  scheduler,
}: {
  signal: AbortSignal
  targetsReady: () => boolean
  timeoutMs: number
  scheduler: LauncherTourTargetScheduler
}): Promise<boolean> {
  return new Promise((resolve) => {
    let frameId: number | undefined
    let timeoutId: number | undefined
    let settled = false

    const cleanup = () => {
      if (frameId !== undefined) {
        scheduler.cancelAnimationFrame(frameId)
        frameId = undefined
      }
      if (timeoutId !== undefined) {
        scheduler.clearTimeout(timeoutId)
        timeoutId = undefined
      }
      signal.removeEventListener('abort', handleAbort)
    }

    const settle = (targetsAvailable: boolean) => {
      if (settled) {
        return
      }

      settled = true
      cleanup()
      resolve(targetsAvailable)
    }

    const checkTargets = () => {
      frameId = undefined
      if (settled) {
        return
      }
      if (signal.aborted) {
        settle(false)
        return
      }
      if (targetsReady()) {
        settle(true)
        return
      }

      frameId = scheduler.requestAnimationFrame(checkTargets)
    }

    function handleAbort() {
      settle(false)
    }

    signal.addEventListener('abort', handleAbort, { once: true })
    timeoutId = scheduler.setTimeout(() => settle(false), timeoutMs)
    checkTargets()
  })
}

/** Decide whether the automatic tour may begin from the current UI state. */
export function isLauncherTourAutoEligible({
  authenticated,
  exactLauncherRoute,
  markerAvailable,
  markerStarted,
  targetsReady,
}: {
  authenticated: boolean
  exactLauncherRoute: boolean
  markerAvailable: boolean
  markerStarted: boolean
  targetsReady: boolean
}): boolean {
  return (
    authenticated &&
    exactLauncherRoute &&
    markerAvailable &&
    !markerStarted &&
    targetsReady
  )
}

/** Identify events after which no part of the tour should remain active. */
export function isLauncherTourTerminalEvent({
  action,
  status,
  type,
}: TourEventSummary): boolean {
  return (
    type === 'tour:end' ||
    type === 'error' ||
    type === 'error:target_not_found' ||
    status === 'finished' ||
    status === 'skipped' ||
    action === 'close' ||
    action === 'skip'
  )
}

/** Select a current-project launcher tab, creating metadata only if absent. */
export function getLauncherTabSelection(
  openTabs: Tab[],
  projectId: string,
  newTabId: string | number,
): LauncherTabSelection {
  const launcherRoute = getLauncherRoute(projectId)
  const existingTab = openTabs.find(
    (tab) =>
      tab.name === 'launcher' &&
      (tab.path.startsWith('/') ? tab.path : `/${tab.path}`) === launcherRoute,
  )

  if (existingTab) {
    return { isNew: false, tab: existingTab }
  }

  return {
    isNew: true,
    tab: {
      id: newTabId,
      title: 'Launcher',
      path: launcherRoute,
      name: 'launcher',
    },
  }
}
