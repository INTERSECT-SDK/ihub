'use client'

/**
 * Provides the campaign execution controller hook, coordinating run state,
 * relay WebSocket lifecycle, relay event buffering, and graph node status
 * updates for the campaign UI.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import type { Node } from '@xyflow/react'
import type {
  CampaignEventMode,
  CampaignModel,
  CampaignNode,
  CodeNode,
} from '@ihub/utils/types/campaign'
import type { JupyterServerConfig } from '@ihub/utils/types/notebook'
import { fetchKernelVariableValue } from '../../ihub_notebook/fetchKernelValue'
import {
  buildCampaignEventWebSocketUrl,
  extractCampaignId,
  extractCampaignRunId,
  runCampaign,
  stopCampaign,
} from './actions'
import {
  useCampaignExecution,
  type NodeStatus,
} from '../state/executionContext'
import {
  getCampaignRelayErrorMessage,
  getCampaignRelayEventDetails,
  isCampaignAbortEvent,
  isCampaignCompleteEvent,
  shouldHandleCampaignRelayEvent,
  type CampaignRelayEvent,
} from './events'
import { useCodeNodeConnectionRegistry } from '../state/codeNodeConnectionRegistryContext'
import { materializeCampaignModelValues } from './materialization'
import { createJsonFileNodeValueResolver } from '../nodes/json-file/jsonFile'
import { createJsonTextNodeValueResolver } from '../nodes/json-text/jsonText'
import {
  canContinueCampaignStart,
  normalizeStartBrokerState,
  type CampaignStartBrokerState,
  isBrokerConnected,
} from './runControls'
import { runCampaignStartSingleFlight } from './startSingleFlight'
import { useCampaignRelay } from './useCampaignRelay'
import {
  fetchLatestCampaignRun,
  recordEventLogRefreshSignal,
  type EventLogRefreshSignals,
} from './eventLogs'
import {
  createCampaignExecutionReplayState,
  discoverActiveCampaignRuns,
  fetchCampaignRecoverySnapshot,
  getCampaignRecoveryEventWatermark,
  getCampaignRecoveryIdentity,
  getRecoveryStopTerminalEventType,
  isRecoveredRelayEventOverlap,
  isRecoveryBrokerLocked,
  reconcileCampaignRecoverySnapshot,
  reduceCampaignExecutionEvent,
  replayCampaignRecoveryEvents,
  resolveCampaignRecoveryStep,
  shouldRetainCompletedCampaignDisplay,
  type CampaignExecutionReplayState,
  type CampaignRecoveryState,
  type CampaignRun,
} from './recovery'
import {
  getExecutableCampaignTasks,
  hasExecutableCampaignTasks,
} from '../model/selectors'

type UseCampaignExecutionControllerInput = {
  executionPayload?: CampaignModel
  nodes: Node[]
  intersectId: string | null
  selectedBrokerStatus: string | null | undefined
  jupyterServers?: JupyterServerConfig[]
  campaignIdentity?: string | null
  isGraphReady?: boolean
  alignBrokerForRecovery?: (brokerId: string) => void
}

type UseCampaignExecutionControllerResult = {
  execute: (payloadOverride?: CampaignModel) => Promise<void>
  stop: () => Promise<boolean>
  isExecutingCampaign: boolean
  isStartingCampaign: boolean
  isStoppingCampaign: boolean
  activeCampaignRunId: string | null
  currentRunId: string | null
  latestLogRunId: string | null
  isLatestLogRunLoading: boolean
  latestLogRunError: string | null
  retryLatestLogRun: () => void
  eventLogRefreshSignals: EventLogRefreshSignals
  executionError: string | null
  dismissExecutionError: () => void
  runIterationsInput: string
  setRunIterationsInput: Dispatch<SetStateAction<string>>
  activeCampaignBrokerId: string | null
  recoveryState: CampaignRecoveryState
  selectRun: (runId: string | null) => void
  selectRecoveryRun: (run: CampaignRun) => void
  retryRecovery: () => void
  isBrokerSelectionLocked: boolean
}

/** Selects an immediate caller override ahead of the render-time payload. */
export function resolveCampaignExecutionPayload(
  executionPayload: CampaignModel | undefined,
  payloadOverride?: CampaignModel,
): CampaignModel | undefined {
  return payloadOverride ?? executionPayload
}

/** Logs the standard error emitted when the selected broker is disconnected. */
function logDisconnectedBroker(): void {
  console.error(
    '[Campaign] Blocked: Selected INTERSECT server is not connected',
  )
}

/**
 * Collects capability node IDs that participate in execution for a payload.
 *
 * @param executionPayload - The model payload when execution uses a serialized graph.
 * @param nodes - The rendered graph nodes used for standard campaign execution.
 * @returns IDs of capability nodes whose statuses should be tracked.
 */
function getExecutionCapabilityNodeIds(
  executionPayload: CampaignModel | undefined,
): string[] {
  return (
    executionPayload?.task_groups.flatMap((taskGroup) =>
      getExecutableCampaignTasks(taskGroup).map((task) => task.id),
    ) ?? []
  )
}

function getEventSettingsByNodeId(
  executionPayload: CampaignModel | undefined,
): Record<string, { mode: CampaignEventMode; count: number | null }> {
  if (executionPayload) {
    return Object.fromEntries(
      executionPayload.task_groups.flatMap((taskGroup) =>
        taskGroup.tasks
          .filter((task) => Boolean(task.event_name) && !task.operation_id)
          .map((task) => [
            task.id,
            {
              mode: task.event_mode ?? 'once',
              count:
                task.event_mode === 'count' ? (task.event_count ?? 1) : null,
            },
          ]),
      ),
    )
  }

  return {}
}

/**
 * Removes the editor's broker selection before submitting a campaign model.
 *
 * @param payload - The complete materialized campaign model to submit.
 * @returns The payload without `selected_broker_id`; authored graph content is
 * otherwise preserved for the submitted run snapshot.
 */
function getExecutionPayloadWithoutSelectedBroker(
  payload: CampaignModel,
): CampaignModel {
  const campaignModel = { ...payload }
  delete campaignModel.selected_broker_id
  return campaignModel
}

/**
 * Owns campaign execution state and relay socket lifecycle for the campaign UI.
 * The hook keeps `Campaign.tsx` focused on rendering while preserving execution
 * behavior such as relay readiness, buffered events, run ID tracking, and node
 * status updates.
 *
 * @param input - Current campaign graph, rendered nodes, and selected broker state.
 * @returns UI-facing execution actions and state for the run controls.
 */
export function useCampaignExecutionController({
  executionPayload,
  nodes,
  intersectId,
  selectedBrokerStatus,
  jupyterServers = [],
  campaignIdentity,
  isGraphReady = true,
  alignBrokerForRecovery,
}: UseCampaignExecutionControllerInput): UseCampaignExecutionControllerResult {
  const codeNodeConnectionRegistry = useCodeNodeConnectionRegistry()
  const {
    state: executionState,
    setCampaignStatus,
    setNodeStatus,
    reset: resetExecutionStatus,
    restore: restoreExecutionStatus,
  } = useCampaignExecution()
  const campaignRelay = useCampaignRelay()
  const [runIterationsInput, setRunIterationsInput] = useState('1')
  const activeCampaignIdRef = useRef<string | null>(null)
  const activeCampaignRunIdRef = useRef<string | null>(null)
  const activeCampaignBrokerIdRef = useRef<string | null>(null)
  const stepToNodeMapRef = useRef<Record<string, string>>({})
  const nextExecutionNodeIndexRef = useRef(0)
  const replayStateRef = useRef<CampaignExecutionReplayState | null>(null)
  const recoveryEventWatermarkRef = useRef<number | null>(null)
  const recoveryGenerationRef = useRef(0)
  const latestLogCampaignIdentityRef = useRef<string | null>(null)
  const recoveryAbortRef = useRef<AbortController | null>(null)
  const attachRecoveryRunRef = useRef<
    (
      run: CampaignRun,
      request?: { generation: number; controller: AbortController },
    ) => Promise<void>
  >(async () => {})
  const isStoppingCampaignRef = useRef(false)
  const isStartingCampaignRef = useRef(false)
  const hasRetainedCompletedDisplayRef = useRef(false)
  const nodeStatusesRef = useRef(executionState.nodeStatuses)
  const latestBrokerStateRef = useRef<CampaignStartBrokerState>({
    brokerId: intersectId,
    status: selectedBrokerStatus,
  })
  const [activeCampaignRunId, setActiveCampaignRunId] = useState<string | null>(
    null,
  )
  const [activeCampaignBrokerId, setActiveCampaignBrokerId] = useState<
    string | null
  >(null)
  const [isStoppingCampaign, setIsStoppingCampaign] = useState(false)
  const [isStartingCampaign, setIsStartingCampaign] = useState(false)
  const [currentRunId, setCurrentRunId] = useState<string | null>(null)
  const [latestLogRunId, setLatestLogRunId] = useState<string | null>(null)
  const [isLatestLogRunLoading, setIsLatestLogRunLoading] = useState(false)
  const [latestLogRunError, setLatestLogRunError] = useState<string | null>(
    null,
  )
  const [latestLogRunRetryKey, setLatestLogRunRetryKey] = useState(0)
  const [eventLogRefreshSignals, setEventLogRefreshSignals] =
    useState<EventLogRefreshSignals>({})
  const [executionError, setExecutionError] = useState<string | null>(null)
  const [recoveryState, setRecoveryState] = useState<CampaignRecoveryState>({
    phase: 'checking',
  })
  const [recoveryRetryKey, setRecoveryRetryKey] = useState(0)
  const resolvedCampaignIdentity =
    campaignIdentity ?? getCampaignRecoveryIdentity(executionPayload)
  const recoveryScopeRef = useRef({
    campaignIdentity: resolvedCampaignIdentity,
    isGraphReady,
  })
  const executionCapabilityNodeIds = useMemo(
    () => getExecutionCapabilityNodeIds(executionPayload),
    [executionPayload],
  )
  const eventSettingsByNodeId = useMemo(
    () => getEventSettingsByNodeId(executionPayload),
    [executionPayload],
  )

  /** Clears the current error message shown by the execution controls. */
  const dismissExecutionError = useCallback(() => {
    setExecutionError(null)
  }, [])

  /** Retries discovery of the newest persisted run used by Event node logs. */
  const retryLatestLogRun = useCallback(() => {
    setLatestLogRunRetryKey((key) => key + 1)
  }, [])

  /**
   * Keeps asynchronous relay handlers synchronized with the latest node statuses.
   */
  useEffect(() => {
    nodeStatusesRef.current = executionState.nodeStatuses
  }, [executionState.nodeStatuses])

  /**
   * Keeps the latest broker selection available to asynchronous start logic.
   * Selection changes during startup are normalized to prevent an unintended run.
   */
  useEffect(() => {
    latestBrokerStateRef.current = normalizeStartBrokerState(
      latestBrokerStateRef.current,
      {
        brokerId: intersectId,
        status: selectedBrokerStatus,
      },
      isStartingCampaignRef.current,
    )
  }, [intersectId, selectedBrokerStatus])

  /** Clears the campaign ID used to filter relay events. */
  const clearActiveCampaign = useCallback(() => {
    activeCampaignIdRef.current = null
  }, [])

  /** Clears the active run ID from both the ref and UI state. */
  const clearActiveCampaignRun = useCallback(() => {
    activeCampaignRunIdRef.current = null
    setActiveCampaignRunId(null)
  }, [])

  /** Records the broker that owns the active campaign run. */
  const recordActiveCampaignBroker = useCallback((brokerId: string | null) => {
    activeCampaignBrokerIdRef.current = brokerId
    setActiveCampaignBrokerId(brokerId)
  }, [])

  /** Records a non-empty run ID for relay filtering and stop requests. */
  const recordActiveCampaignRun = useCallback((runId: string | null) => {
    if (!runId) {
      return
    }

    activeCampaignRunIdRef.current = runId
    setActiveCampaignRunId(runId)
    setCurrentRunId(runId)
    setLatestLogRunId(runId)
  }, [])

  /** Selects a specific persisted campaign run for display in the editor. */
  const selectRun = useCallback((runId: string | null) => {
    setCurrentRunId(runId)
    setLatestLogRunId(runId)
  }, [])

  /** Marks any in-flight stop request as complete. */
  const clearStopRequest = useCallback(() => {
    isStoppingCampaignRef.current = false
    setIsStoppingCampaign(false)
  }, [])

  /** Clears the run identity and node snapshot currently displayed by the editor. */
  const clearExecutionDisplay = useCallback(() => {
    hasRetainedCompletedDisplayRef.current =
      shouldRetainCompletedCampaignDisplay({ source: 'reset' })
    replayStateRef.current = null
    recoveryEventWatermarkRef.current = null
    nodeStatusesRef.current = {}
    setCurrentRunId(null)
    resetExecutionStatus()
  }, [resetExecutionStatus])

  /** Clears active tracking and starts authoritative active-run discovery. */
  const rediscoverAfterTerminal = useCallback(
    (retainCompletedDisplay = false) => {
      hasRetainedCompletedDisplayRef.current = retainCompletedDisplay
      if (!retainCompletedDisplay) {
        clearExecutionDisplay()
      }
      clearActiveCampaign()
      clearActiveCampaignRun()
      recordActiveCampaignBroker(null)
      clearStopRequest()
      campaignRelay.close()
      setRecoveryState({ phase: 'checking' })
      setRecoveryRetryKey((key) => key + 1)
    },
    [
      campaignRelay,
      clearActiveCampaign,
      clearActiveCampaignRun,
      clearExecutionDisplay,
      clearStopRequest,
      recordActiveCampaignBroker,
    ],
  )

  /**
   * Updates a node status while keeping the synchronous relay-event snapshot current.
   *
   * @param nodeId - ID of the graph node whose status changed.
   * @param status - New execution status for the node.
   */
  const setTrackedNodeStatus = useCallback(
    (nodeId: string, status: NodeStatus) => {
      nodeStatusesRef.current = {
        ...nodeStatusesRef.current,
        [nodeId]: status,
      }
      setNodeStatus(nodeId, status)
    },
    [setNodeStatus],
  )

  /**
   * Applies one live relay event to the execution state.
   *
   * @param relayEvent - Event received from the campaign relay.
   */
  const handleRelayEvent = useCallback(
    (relayEvent: CampaignRelayEvent) => {
      const { campaignId, runId, eventType, taskId, persistedEventId } =
        getCampaignRelayEventDetails(relayEvent)

      console.log('[Campaign] Orchestrator relay event', {
        campaignId,
        runId,
        eventType,
        relayEvent,
      })

      if (
        !shouldHandleCampaignRelayEvent(
          activeCampaignIdRef.current,
          activeCampaignRunIdRef.current,
          relayEvent,
        )
      ) {
        return
      }

      if (
        isRecoveredRelayEventOverlap(
          persistedEventId,
          recoveryEventWatermarkRef.current,
        )
      ) {
        return
      }

      recordActiveCampaignRun(runId)
      const trackedRunId = activeCampaignRunIdRef.current
      if (!trackedRunId) return

      if (
        taskId &&
        persistedEventId &&
        Object.hasOwn(eventSettingsByNodeId, taskId)
      ) {
        setEventLogRefreshSignals((signals) =>
          recordEventLogRefreshSignal(
            signals,
            trackedRunId,
            taskId,
            persistedEventId,
          ),
        )
      }

      const ignoredNodeIds = nodes
        .filter((node) => node.type !== 'capability' && node.type !== 'event')
        .map((node) => node.id)
      const previousReplayState = replayStateRef.current ?? {
        ...createCampaignExecutionReplayState(executionCapabilityNodeIds),
        nodeStatuses: nodeStatusesRef.current,
        stepToNodeMap: stepToNodeMapRef.current,
        nextExecutionNodeIndex: nextExecutionNodeIndexRef.current,
      }
      const nextReplayState = reduceCampaignExecutionEvent(
        previousReplayState,
        relayEvent,
        {
          runId: trackedRunId,
          executionNodeIds: executionCapabilityNodeIds,
          ignoredNodeIds,
          eventSettingsByNodeId,
        },
      )
      if (nextReplayState === previousReplayState) return

      replayStateRef.current = nextReplayState
      stepToNodeMapRef.current = nextReplayState.stepToNodeMap
      nextExecutionNodeIndexRef.current = nextReplayState.nextExecutionNodeIndex
      nodeStatusesRef.current = nextReplayState.nodeStatuses
      restoreExecutionStatus(
        nextReplayState.campaignStatus,
        nextReplayState.nodeStatuses,
        nextReplayState.nodeRunCounts,
      )

      if (nextReplayState.terminal) {
        if (isCampaignAbortEvent(eventType)) {
          const errorMessage = getCampaignRelayErrorMessage(relayEvent)
          setExecutionError(errorMessage ?? `Campaign failed: ${eventType}`)
        }
        const recoveryStep = resolveCampaignRecoveryStep({
          source: 'live-terminal',
        })
        if (recoveryStep.action === 'rediscover') {
          rediscoverAfterTerminal(
            shouldRetainCompletedCampaignDisplay({
              source: 'live-terminal',
              successful: isCampaignCompleteEvent(eventType),
            }),
          )
        }
      }
    },
    [
      executionCapabilityNodeIds,
      eventSettingsByNodeId,
      nodes,
      recordActiveCampaignRun,
      rediscoverAfterTerminal,
      restoreExecutionStatus,
      setExecutionError,
    ],
  )

  /**
   * Reconnects controller state to an active backend run and replays its history.
   *
   * @param run - Active run to attach to.
   * @param request - Optional generation and abort signal shared with recovery discovery.
   */
  const attachRecoveryRun = useCallback(
    async (
      run: CampaignRun,
      request?: { generation: number; controller: AbortController },
    ) => {
      const generation = request?.generation ?? ++recoveryGenerationRef.current
      const controller = request?.controller ?? new AbortController()
      if (!request) {
        recoveryAbortRef.current?.abort()
        recoveryAbortRef.current = controller
      }

      clearExecutionDisplay()
      setRecoveryState({ phase: 'attaching', run })
      setExecutionError(null)
      clearStopRequest()
      activeCampaignIdRef.current = run.campaign_id
      recordActiveCampaignRun(run.run_id)
      replayStateRef.current = createCampaignExecutionReplayState(
        executionCapabilityNodeIds,
      )
      nodeStatusesRef.current = replayStateRef.current.nodeStatuses
      restoreExecutionStatus(
        'executing',
        replayStateRef.current.nodeStatuses,
        replayStateRef.current.nodeRunCounts,
      )

      if (run.broker_id == null) {
        recordActiveCampaignBroker(null)
        setRecoveryState({
          phase: 'error',
          run,
          message:
            'This active run predates broker tracking. It cannot be reattached or stopped safely because no INTERSECT server ID was recorded.',
        })
        return
      }

      const brokerId = String(run.broker_id)
      recordActiveCampaignBroker(brokerId)
      alignBrokerForRecovery?.(brokerId)
      campaignRelay.close()

      try {
        await campaignRelay.connect(buildCampaignEventWebSocketUrl(brokerId))
        if (
          controller.signal.aborted ||
          generation !== recoveryGenerationRef.current
        ) {
          campaignRelay.close()
          return
        }

        const snapshot = await fetchCampaignRecoverySnapshot(
          run.run_id,
          controller.signal,
        )
        if (
          controller.signal.aborted ||
          generation !== recoveryGenerationRef.current
        ) {
          campaignRelay.close()
          return
        }

        const replayConfig = {
          runId: run.run_id,
          executionNodeIds: executionCapabilityNodeIds,
          ignoredNodeIds: nodes
            .filter(
              (node) => node.type !== 'capability' && node.type !== 'event',
            )
            .map((node) => node.id),
          eventSettingsByNodeId,
        }
        const restoredState = reconcileCampaignRecoverySnapshot(
          replayCampaignRecoveryEvents(snapshot.events, replayConfig),
          snapshot.run.status,
        )

        replayStateRef.current = restoredState
        stepToNodeMapRef.current = restoredState.stepToNodeMap
        nextExecutionNodeIndexRef.current = restoredState.nextExecutionNodeIndex
        nodeStatusesRef.current = restoredState.nodeStatuses
        restoreExecutionStatus(
          restoredState.campaignStatus,
          restoredState.nodeStatuses,
          restoredState.nodeRunCounts,
        )

        const recoveryStep = resolveCampaignRecoveryStep({
          source: 'snapshot',
          run: snapshot.run,
          terminal: restoredState.terminal,
        })
        if (recoveryStep.action === 'rediscover') {
          rediscoverAfterTerminal(
            shouldRetainCompletedCampaignDisplay({
              source: 'snapshot-terminal',
            }),
          )
          return
        }

        setRecoveryState({ phase: 'attached', run: recoveryStep.run })
        recoveryEventWatermarkRef.current = getCampaignRecoveryEventWatermark(
          snapshot.events,
        )
        try {
          campaignRelay.activate(handleRelayEvent)
        } finally {
          recoveryEventWatermarkRef.current = null
        }
      } catch (error) {
        if (
          controller.signal.aborted ||
          generation !== recoveryGenerationRef.current
        ) {
          return
        }
        campaignRelay.close()
        const message =
          error instanceof Error
            ? error.message
            : 'The active campaign run could not be restored.'
        setRecoveryState({ phase: 'error', run, message })
      }
    },
    [
      alignBrokerForRecovery,
      campaignRelay,
      clearStopRequest,
      clearExecutionDisplay,
      executionCapabilityNodeIds,
      eventSettingsByNodeId,
      handleRelayEvent,
      nodes,
      recordActiveCampaignBroker,
      recordActiveCampaignRun,
      rediscoverAfterTerminal,
      restoreExecutionStatus,
    ],
  )

  /**
   * Keeps recovery discovery pointed at the latest attachment callback without
   * restarting discovery when the callback's dependencies change.
   */
  useEffect(() => {
    attachRecoveryRunRef.current = attachRecoveryRun
  }, [attachRecoveryRun])

  /**
   * Discovers the newest persisted run for Event node logs whenever the campaign
   * context becomes ready or the user retries, aborting stale requests on cleanup.
   */
  useEffect(() => {
    const campaignChanged =
      latestLogCampaignIdentityRef.current !== resolvedCampaignIdentity
    latestLogCampaignIdentityRef.current = resolvedCampaignIdentity
    if (campaignChanged) {
      setLatestLogRunId(null)
      setLatestLogRunError(null)
      setEventLogRefreshSignals({})
    }

    if (!resolvedCampaignIdentity || !isGraphReady) {
      setIsLatestLogRunLoading(false)
      return
    }

    const controller = new AbortController()
    setIsLatestLogRunLoading(true)
    setLatestLogRunError(null)
    void fetchLatestCampaignRun(resolvedCampaignIdentity, controller.signal)
      .then((run) => {
        if (!controller.signal.aborted && !activeCampaignRunIdRef.current) {
          setLatestLogRunId(run?.run_id ?? null)
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          console.error('[Campaign] Latest log run lookup failed:', error)
          setLatestLogRunError(
            error instanceof Error
              ? error.message
              : 'Could not look up the latest campaign run.',
          )
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLatestLogRunLoading(false)
        }
      })

    return () => controller.abort()
  }, [isGraphReady, latestLogRunRetryKey, resolvedCampaignIdentity])

  /**
   * Resets execution state for the current recovery scope, discovers active runs,
   * and attaches automatically when recovery resolves to a single candidate.
   * Cleanup aborts stale discovery and closes the campaign relay.
   */
  useEffect(() => {
    if (
      isStartingCampaignRef.current ||
      activeCampaignRunIdRef.current !== null
    ) {
      return () => {}
    }

    const generation = ++recoveryGenerationRef.current
    recoveryAbortRef.current?.abort()
    const controller = new AbortController()
    recoveryAbortRef.current = controller
    const previousRecoveryScope = recoveryScopeRef.current
    const recoveryScopeChanged =
      previousRecoveryScope.campaignIdentity !== resolvedCampaignIdentity ||
      previousRecoveryScope.isGraphReady !== isGraphReady
    recoveryScopeRef.current = {
      campaignIdentity: resolvedCampaignIdentity,
      isGraphReady,
    }
    campaignRelay.close()
    clearActiveCampaign()
    clearActiveCampaignRun()
    recordActiveCampaignBroker(null)
    clearStopRequest()
    if (recoveryScopeChanged || !hasRetainedCompletedDisplayRef.current) {
      clearExecutionDisplay()
    }

    if (!resolvedCampaignIdentity || !isGraphReady) {
      setRecoveryState({ phase: 'checking' })
      return () => controller.abort()
    }

    setRecoveryState({ phase: 'checking' })
    void discoverActiveCampaignRuns(resolvedCampaignIdentity, controller.signal)
      .then(async (runs) => {
        if (
          controller.signal.aborted ||
          generation !== recoveryGenerationRef.current
        ) {
          return
        }
        const recoveryStep = resolveCampaignRecoveryStep({
          source: 'discovery',
          runs,
        })
        const retainCompletedDisplay = shouldRetainCompletedCampaignDisplay({
          source: 'discovery',
          hasRetainedDisplay: hasRetainedCompletedDisplayRef.current,
          activeRunCount: runs.length,
        })
        if (!retainCompletedDisplay) {
          clearExecutionDisplay()
        }
        if (recoveryStep.action === 'ready') {
          setRecoveryState({ phase: 'ready' })
        } else if (recoveryStep.action === 'select') {
          setRecoveryState({
            phase: 'selection-required',
            runs: recoveryStep.runs,
          })
        } else if (recoveryStep.action === 'attach') {
          await attachRecoveryRunRef.current(recoveryStep.run, {
            generation,
            controller,
          })
        }
      })
      .catch((error) => {
        if (
          controller.signal.aborted ||
          generation !== recoveryGenerationRef.current
        ) {
          return
        }
        setRecoveryState({
          phase: 'error',
          message:
            error instanceof Error
              ? error.message
              : 'Active campaign runs could not be checked.',
        })
        hasRetainedCompletedDisplayRef.current =
          shouldRetainCompletedCampaignDisplay({
            source: 'recovery-error',
            hasRetainedDisplay: hasRetainedCompletedDisplayRef.current,
          })
      })

    return () => {
      controller.abort()
      campaignRelay.close()
    }
  }, [
    campaignRelay,
    clearActiveCampaign,
    clearActiveCampaignRun,
    clearExecutionDisplay,
    clearStopRequest,
    isGraphReady,
    recoveryRetryKey,
    recordActiveCampaignBroker,
    resolvedCampaignIdentity,
  ])

  /**
   * Selects an active run when recovery discovers multiple candidates.
   *
   * @param run - Run selected by the user for attachment.
   */
  const selectRecoveryRun = useCallback((run: CampaignRun) => {
    void attachRecoveryRunRef.current(run)
  }, [])

  /** Retries the failed attachment or active-run discovery operation. */
  const retryRecovery = useCallback(() => {
    if (recoveryState.phase === 'error' && recoveryState.run) {
      void attachRecoveryRunRef.current(recoveryState.run)
      return
    }
    setRecoveryRetryKey((key) => key + 1)
  }, [recoveryState])

  /**
   * Starts campaign execution after validating UI state and relay readiness.
   * The function normalizes iterations, prevents re-entry, buffers relay events
   * until the start response arrives, and tears down the socket on all terminal
   * failure or completion paths.
   */
  const execute = useCallback(
    async (payloadOverride?: CampaignModel) => {
      const effectiveExecutionPayload = resolveCampaignExecutionPayload(
        executionPayload,
        payloadOverride,
      )

      if (recoveryState.phase !== 'ready') {
        console.warn('[Campaign] Blocked: active-run recovery is unresolved')
        return
      }

      if (!effectiveExecutionPayload) {
        console.warn('[Campaign] Blocked: campaign data is unavailable')
        return
      }
      if (!hasExecutableCampaignTasks(effectiveExecutionPayload)) {
        console.warn('[Campaign] Blocked: campaign has no executable tasks')
        return
      }

      if (executionState.campaignStatus === 'executing') {
        console.warn('[Campaign] Ignored: campaign is already executing')
        return
      }

      if (!intersectId) {
        console.error('[Campaign] Blocked: No INTERSECT server selected')
        return
      }

      if (!isBrokerConnected(selectedBrokerStatus)) {
        logDisconnectedBroker()
        return
      }

      const startBrokerId = intersectId

      await runCampaignStartSingleFlight({
        guard: isStartingCampaignRef,
        onStartingChange: setIsStartingCampaign,
        start: async () => {
          setExecutionError(null)
          // A terminal event may have started recovery discovery before React
          // rendered its disabled state. A new start supersedes that discovery.
          recoveryGenerationRef.current += 1
          recoveryAbortRef.current?.abort()
          clearExecutionDisplay()

          let executionRequestData = effectiveExecutionPayload
          try {
            const valueResolvers = {
              resolveCodeNodeValue: async (
                sourceNode: CampaignNode,
                sourceParameter: string,
              ) => {
                const connection = codeNodeConnectionRegistry.getOpenConnection(
                  sourceNode.id,
                )
                const kernel = (sourceNode.data as CodeNode).kernel

                if (!connection || !kernel?.id) {
                  throw new Error('No open Jupyter connection')
                }

                return fetchKernelVariableValue(
                  connection,
                  kernel.id,
                  sourceParameter,
                )
              },
              resolveJsonFileNodeValue: (
                sourceNode: CampaignNode,
                sourceParameter: string,
              ) =>
                sourceNode.type === 'json-text'
                  ? createJsonTextNodeValueResolver()(
                      sourceNode,
                      sourceParameter,
                    )
                  : createJsonFileNodeValueResolver(jupyterServers)(
                      sourceNode,
                      sourceParameter,
                    ),
            }

            executionRequestData = await materializeCampaignModelValues(
              effectiveExecutionPayload,
              valueResolvers,
            )
          } catch (error) {
            const message =
              error instanceof Error
                ? error.message
                : 'A frontend source-node mapping could not be resolved'
            console.error(
              '[Campaign] Source-node value materialization failed:',
              error,
            )
            setExecutionError(message)
            return
          }

          if (
            !canContinueCampaignStart(
              startBrokerId,
              latestBrokerStateRef.current,
            )
          ) {
            logDisconnectedBroker()
            return
          }

          const parsedIterations = Number.parseInt(runIterationsInput, 10)
          const totalIterations = Number.isFinite(parsedIterations)
            ? Math.max(1, parsedIterations)
            : 1
          setRunIterationsInput(String(totalIterations))

          campaignRelay.close()
          clearActiveCampaign()
          clearActiveCampaignRun()
          recordActiveCampaignBroker(null)
          clearStopRequest()
          stepToNodeMapRef.current = {}
          nextExecutionNodeIndexRef.current = 0
          replayStateRef.current = createCampaignExecutionReplayState(
            executionCapabilityNodeIds,
          )
          executionCapabilityNodeIds.forEach((nodeId) => {
            setTrackedNodeStatus(nodeId, 'waiting')
          })

          try {
            await campaignRelay.connect(
              buildCampaignEventWebSocketUrl(startBrokerId),
            )
          } catch (error) {
            console.error('[Campaign] Campaign relay readiness failed:', error)
            clearStopRequest()
            campaignRelay.close()
            return
          }

          if (!campaignRelay.isOpen()) {
            console.error(
              '[Campaign] Campaign relay websocket closed before campaign start',
            )
            clearStopRequest()
            campaignRelay.close()
            return
          }

          if (
            !canContinueCampaignStart(
              startBrokerId,
              latestBrokerStateRef.current,
            )
          ) {
            logDisconnectedBroker()
            campaignRelay.close()
            return
          }

          try {
            const executionRequestPayload =
              getExecutionPayloadWithoutSelectedBroker(executionRequestData!)
            const res = await runCampaign(
              executionRequestPayload,
              startBrokerId,
            )

            const startedCampaignId = extractCampaignId(res)
            const startedCampaignRunId = extractCampaignRunId(res)
            activeCampaignIdRef.current = startedCampaignId
            recordActiveCampaignRun(startedCampaignRunId)
            recordActiveCampaignBroker(startBrokerId)
            setCampaignStatus('executing')

            if (!startedCampaignId) {
              console.warn(
                '[Campaign] Campaign start response did not include campaign_id; processing buffered events without filtering.',
              )
            }

            campaignRelay.activate(handleRelayEvent)
          } catch (error) {
            console.error('[Campaign] Campaign execution failed:', error)
            setExecutionError(
              error instanceof Error
                ? error.message
                : 'Campaign execution failed',
            )
            clearActiveCampaign()
            clearActiveCampaignRun()
            recordActiveCampaignBroker(null)
            clearStopRequest()
            setCampaignStatus('idle')
            campaignRelay.close()
            return
          }
        },
      })
    },
    [
      codeNodeConnectionRegistry,
      clearActiveCampaign,
      clearActiveCampaignRun,
      clearExecutionDisplay,
      clearStopRequest,
      campaignRelay,
      executionPayload,
      executionCapabilityNodeIds,
      executionState.campaignStatus,
      handleRelayEvent,
      intersectId,
      jupyterServers,
      recordActiveCampaignRun,
      recordActiveCampaignBroker,
      recoveryState.phase,
      runIterationsInput,
      selectedBrokerStatus,
      setCampaignStatus,
      setTrackedNodeStatus,
    ],
  )

  /**
   * Stops the active campaign after a start response or relay event has supplied
   * the run ID required by the backend stop route.
   *
   * @returns True when the backend accepted the stop request.
   */
  const stop = useCallback(async () => {
    const campaignRunId = activeCampaignRunIdRef.current
    const campaignBrokerId = activeCampaignBrokerIdRef.current

    if (isStoppingCampaignRef.current) {
      return false
    }

    if (executionState.campaignStatus !== 'executing') {
      console.warn('[Campaign] Ignored: campaign is not executing')
      return false
    }

    if (!campaignBrokerId) {
      console.error('[Campaign] Blocked: Active campaign broker id is unknown')
      return false
    }

    if (!campaignRunId) {
      console.error('[Campaign] Blocked: No active campaign run id to stop')
      return false
    }

    isStoppingCampaignRef.current = true
    setIsStoppingCampaign(true)

    try {
      const stopResponse = await stopCampaign(campaignBrokerId, campaignRunId)
      if (recoveryState.phase === 'error' && recoveryState.run) {
        const terminalEventType = getRecoveryStopTerminalEventType(stopResponse)
        if (!terminalEventType) {
          clearStopRequest()
          return false
        }
        handleRelayEvent({
          campaign_id: recoveryState.run.campaign_id,
          run_id: campaignRunId,
          event: { event_type: terminalEventType },
        })
      }
      return true
    } catch (error) {
      console.error('[Campaign] Campaign stop failed:', error)
      clearStopRequest()
      return false
    }
  }, [
    clearStopRequest,
    executionState.campaignStatus,
    handleRelayEvent,
    recoveryState,
  ])

  return {
    execute,
    stop,
    isExecutingCampaign: executionState.campaignStatus === 'executing',
    isStartingCampaign,
    isStoppingCampaign,
    activeCampaignRunId,
    currentRunId,
    latestLogRunId,
    isLatestLogRunLoading,
    latestLogRunError,
    retryLatestLogRun,
    eventLogRefreshSignals,
    executionError,
    dismissExecutionError,
    runIterationsInput,
    setRunIterationsInput,
    activeCampaignBrokerId,
    recoveryState,
    selectRun,
    selectRecoveryRun,
    retryRecovery,
    isBrokerSelectionLocked:
      isRecoveryBrokerLocked(recoveryState) || Boolean(activeCampaignRunId),
  }
}
