'use client'

import { useSession } from '@/app/providers/SessionProvider.tsx'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EVENTS, Joyride, type EventData, type Step } from 'react-joyride'

import {
  getLauncherTourMarkerKey,
  isLauncherRoute,
  isLauncherTourTerminalEvent,
  LAUNCHER_TOUR_TARGETS,
  LAUNCHER_TOUR_TARGET_WAIT_MS,
  readLauncherTourMarker,
  reserveLauncherTourAutoStart,
  waitForLauncherTourTargets,
  writeLauncherTourMarker,
} from './launcher-tour.ts'

const steps: Step[] = [
  {
    target: '[data-tour="launcher-create"]',
    title: 'Create a document',
    content:
      'Start a Campaign, Notebook, or LLM Chat document from the launcher.',
    placement: 'bottom-start',
  },
  {
    target: '[data-tour="launcher"]',
    title: 'Browse capabilities',
    content:
      'Capabilities discovered from connected services appear here for you to browse.',
    placement: 'top-start',
  },
  {
    target: '[data-tour="nav-project-selection"]',
    title: 'Return to Projects',
    content: 'Click iHub to return to the project selection page.',
    placement: 'right',
  },
  {
    target: '[data-tour="nav-project-activity"]',
    title: 'Project activity',
    content:
      'Use Project Files, Notifications, and Active Experiments to follow work in this project.',
    placement: 'right-start',
  },
  {
    target: '[data-tour="nav-connections"]',
    title: 'Connections',
    content:
      'Manage INTERSECT, Agents, LLM, MCP, and Jupyter connections from this group.',
    placement: 'right',
  },
  {
    target: '[data-tour="nav-utilities"]',
    title: 'Settings and account',
    content:
      'Open iHub Settings or Account here. Choose Take a tour in Account whenever you want to replay this guide.',
    placement: 'right-end',
  },
]

function elementIsVisible(element: Element | null): boolean {
  if (!element) {
    return false
  }

  const bounds = element.getBoundingClientRect()
  const style = window.getComputedStyle(element)

  return (
    bounds.width > 0 &&
    bounds.height > 0 &&
    style.display !== 'none' &&
    style.visibility !== 'hidden'
  )
}

function allTargetsAreVisible(): boolean {
  return LAUNCHER_TOUR_TARGETS.every((target) =>
    elementIsVisible(document.querySelector(`[data-tour="${target}"]`)),
  )
}

function waitForTargets(signal: AbortSignal): Promise<boolean> {
  return waitForLauncherTourTargets({
    signal,
    targetsReady: allTargetsAreVisible,
    timeoutMs: LAUNCHER_TOUR_TARGET_WAIT_MS,
    scheduler: {
      cancelAnimationFrame: (frameId) => window.cancelAnimationFrame(frameId),
      clearTimeout: (timeoutId) => window.clearTimeout(timeoutId),
      requestAnimationFrame: (callback) =>
        window.requestAnimationFrame(callback),
      setTimeout: (callback, timeoutMs) =>
        window.setTimeout(callback, timeoutMs),
    },
  })
}

async function reserveAutoStartAcrossPages(
  signal: AbortSignal,
  markerKey: string,
  eligibility: {
    authenticated: boolean
    exactLauncherRoute: boolean
    targetsReady: boolean
  },
): Promise<boolean> {
  if (!navigator.locks) {
    return reserveLauncherTourAutoStart(
      window.localStorage,
      markerKey,
      eligibility,
    )
  }

  try {
    return await navigator.locks.request(
      `ihub:launcher-tour:auto-start-lock:${markerKey}`,
      { mode: 'exclusive', signal },
      () =>
        reserveLauncherTourAutoStart(
          window.localStorage,
          markerKey,
          eligibility,
        ),
    )
  } catch {
    return false
  }
}

type LauncherTourControllerProps = {
  projectId: string
  replayRequest: number
}

/**
 * Owns the explanation-only launcher tour across launcher and document routes.
 * Automatic runs are user-scoped; replay requests always restart at step zero.
 */
export default function LauncherTourController({
  projectId,
  replayRequest,
}: LauncherTourControllerProps) {
  const pathname = usePathname()
  const { session, status: sessionStatus } = useSession()
  const lastReplayRequest = useRef(0)
  const pendingReplay = useRef<
    | {
        projectId: string
        request: number
        userId: string
      }
    | undefined
  >(undefined)
  const replayWaitStarted = useRef<number | undefined>(undefined)
  const activeRunUserId = useRef<string | undefined>(undefined)
  const [run, setRun] = useState(false)
  const [runId, setRunId] = useState(0)
  const userId = session?.user.id
  const markerKey = useMemo(
    () => (userId ? getLauncherTourMarkerKey(userId) : undefined),
    [userId],
  )

  const handleEvent = useCallback(
    (event: EventData) => {
      if (event.type === EVENTS.TOUR_START) {
        if (markerKey) {
          writeLauncherTourMarker(window.localStorage, markerKey)
        }
      }

      if (isLauncherTourTerminalEvent(event)) {
        activeRunUserId.current = undefined
        setRun(false)
      }
    },
    [markerKey],
  )

  const startTour = useCallback(() => {
    activeRunUserId.current = userId
    setRunId((currentRunId) => currentRunId + 1)
    setRun(true)
  }, [userId])

  useEffect(() => {
    const abortController = new AbortController()
    const hasPendingReplay =
      replayRequest > 0 && replayRequest !== lastReplayRequest.current

    if (
      hasPendingReplay ||
      sessionStatus !== 'authenticated' ||
      !userId ||
      !markerKey ||
      !isLauncherRoute(pathname, projectId)
    ) {
      return () => abortController.abort()
    }

    const marker = readLauncherTourMarker(window.localStorage, markerKey)
    if (!marker.available || marker.started) {
      return () => abortController.abort()
    }

    void waitForTargets(abortController.signal).then(async (targetsReady) => {
      if (abortController.signal.aborted) {
        return
      }

      const reserved = await reserveAutoStartAcrossPages(
        abortController.signal,
        markerKey,
        {
          authenticated: sessionStatus === 'authenticated',
          exactLauncherRoute: isLauncherRoute(pathname, projectId),
          targetsReady,
        },
      )
      if (reserved && !abortController.signal.aborted) {
        startTour()
      }
    })

    return () => abortController.abort()
  }, [
    markerKey,
    pathname,
    projectId,
    replayRequest,
    sessionStatus,
    startTour,
    userId,
  ])

  useEffect(() => {
    const exactLauncherRoute = isLauncherRoute(pathname, projectId)

    if (
      !exactLauncherRoute &&
      replayWaitStarted.current === replayRequest &&
      pendingReplay.current?.request === replayRequest
    ) {
      lastReplayRequest.current = replayRequest
      pendingReplay.current = undefined
      replayWaitStarted.current = undefined
      return
    }

    if (
      replayRequest <= 0 ||
      replayRequest === lastReplayRequest.current ||
      sessionStatus !== 'authenticated' ||
      !userId ||
      !exactLauncherRoute
    ) {
      return
    }

    if (pendingReplay.current?.request !== replayRequest) {
      pendingReplay.current = { projectId, request: replayRequest, userId }
    }

    if (
      pendingReplay.current.projectId !== projectId ||
      pendingReplay.current.userId !== userId
    ) {
      lastReplayRequest.current = replayRequest
      pendingReplay.current = undefined
      replayWaitStarted.current = undefined
      return
    }

    const abortController = new AbortController()
    replayWaitStarted.current = replayRequest
    void waitForTargets(abortController.signal).then((targetsReady) => {
      if (abortController.signal.aborted) {
        return
      }

      if (!targetsReady) {
        lastReplayRequest.current = replayRequest
        pendingReplay.current = undefined
        replayWaitStarted.current = undefined
        return
      }

      lastReplayRequest.current = replayRequest
      pendingReplay.current = undefined
      replayWaitStarted.current = undefined
      startTour()
    })

    return () => abortController.abort()
  }, [pathname, projectId, replayRequest, sessionStatus, startTour, userId])

  useEffect(() => {
    if (
      run &&
      (sessionStatus !== 'authenticated' ||
        !isLauncherRoute(pathname, projectId) ||
        activeRunUserId.current !== userId)
    ) {
      activeRunUserId.current = undefined
      setRun(false)
    }
  }, [pathname, projectId, run, sessionStatus, userId])

  return (
    <Joyride
      key={runId}
      continuous
      onEvent={handleEvent}
      options={{
        blockTargetInteraction: true,
        buttons: ['back', 'close', 'primary', 'skip'],
        closeButtonAction: 'skip',
        dismissKeyAction: false,
        overlayClickAction: false,
        showProgress: true,
        skipBeacon: true,
        targetWaitTimeout: LAUNCHER_TOUR_TARGET_WAIT_MS,
        zIndex: 1000,
      }}
      run={run}
      steps={steps}
    />
  )
}
