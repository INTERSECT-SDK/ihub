/**
 * Provides campaign run discovery, recovery snapshot loading, and deterministic
 * replay utilities for restoring execution state after reconnecting.
 */
import type {
  CampaignEventMode,
  CampaignModel,
} from '@ihub/utils/types/campaign'

import type { CampaignStatus, NodeStatus } from '../state/executionContext'
import type { CampaignRelayEvent } from './events'
// Node's focused TypeScript test runner requires the imported file extension.
// @ts-expect-error TypeScript extensions are valid here because this package is no-emit.
import * as campaignEvents from './events.ts'

const { getCampaignRelayEventDetails } = campaignEvents
export type CampaignRun = {
  id: number
  user_email: string | null
  campaign_id: string
  run_id: string
  run_at: string
  orchestrator_url: string | null
  status: 'ACTIVE' | 'COMPLETED' | 'ABORTED' | null
  outcome?: 'SUCCEEDED' | 'FAILED' | 'CANCELED' | 'INTERRUPTED' | null
  ended_at: string | null
  campaign_name: string | null
  broker_id: number | null
  snapshot_available?: boolean
}

export type CampaignRunSnapshots = {
  schema_version: number
  run_id: string
  captured_at: string
  submitted_document_kind: 'icmp' | 'orchestrator_campaign'
  submitted_campaign: Record<string, unknown>
  orchestrator_campaign: Record<string, unknown>
}

export type CampaignRecoveryEvent = {
  id: number
  campaign_id: string
  run_id: string | null
  step_id: string | null
  created_at: string
  event_type: string | null
  fields_to_populate: string[] | null
  exception_message: string | null
  payload: CampaignRelayEvent | null
}

export type CampaignRecoverySnapshot = {
  run: CampaignRun
  events: CampaignRecoveryEvent[]
}

export type CampaignRecoveryState =
  | { phase: 'checking' }
  | { phase: 'selection-required'; runs: CampaignRun[] }
  | { phase: 'attaching'; run: CampaignRun }
  | { phase: 'attached'; run: CampaignRun }
  | { phase: 'ready' }
  | { phase: 'error'; message: string; run?: CampaignRun }

export type CampaignRecoveryStepInput =
  | {
      source: 'snapshot'
      run: CampaignRun
      terminal: boolean
    }
  | {
      source: 'live-terminal'
    }
  | {
      source: 'discovery'
      runs: CampaignRun[]
    }

export type CampaignRecoveryStepDecision =
  | { action: 'rediscover' }
  | { action: 'attached'; run: CampaignRun }
  | { action: 'ready' }
  | { action: 'attach'; run: CampaignRun }
  | { action: 'select'; runs: CampaignRun[] }

export type CampaignExecutionReplayState = {
  campaignStatus: CampaignStatus
  nodeStatuses: Record<string, NodeStatus>
  nodeRunCounts: Record<string, number>
  stepToNodeMap: Record<string, string>
  nextExecutionNodeIndex: number
  eventCompletionCounts: Record<string, number>
  terminal: boolean
}

export type CampaignExecutionReplayConfig = {
  runId: string
  executionNodeIds: readonly string[]
  ignoredNodeIds?: readonly string[]
  eventSettingsByNodeId?: Record<
    string,
    { mode: CampaignEventMode; count: number | null }
  >
}

export type CampaignRecoveryTerminalEventType =
  | 'UNKNOWN_ERROR'
  | 'CAMPAIGN_COMPLETE'

export type CampaignCompletedDisplayRetentionInput =
  | {
      source: 'live-terminal'
      successful: boolean
    }
  | {
      source: 'discovery'
      hasRetainedDisplay: boolean
      activeRunCount: number
    }
  | {
      source: 'recovery-error'
      hasRetainedDisplay: boolean
    }
  | {
      source: 'snapshot-terminal' | 'reset'
    }

const ACTIVE_RUN_PAGE_SIZE = 100

/**
 * Determines whether a successfully completed run may remain displayed while
 * active-run recovery proceeds.
 *
 * @param input - The lifecycle event that can retain or replace the display.
 * @returns Whether the mounted editor should keep its completed-run display.
 */
export function shouldRetainCompletedCampaignDisplay(
  input: CampaignCompletedDisplayRetentionInput,
): boolean {
  switch (input.source) {
    case 'live-terminal':
      return input.successful
    case 'discovery':
      return input.hasRetainedDisplay && input.activeRunCount === 0
    case 'recovery-error':
      return input.hasRetainedDisplay
    case 'snapshot-terminal':
    case 'reset':
      return false
  }
}

/**
 * Chooses the next recovery step after a snapshot or active-run discovery.
 * Keeping this transition table outside the controller ensures a terminal
 * snapshot can never enable Run before the campaign is queried again.
 *
 * @param input - Authoritative snapshot or active-run discovery result.
 * @returns The single recovery action the controller should perform next.
 */
export function resolveCampaignRecoveryStep(
  input: Extract<CampaignRecoveryStepInput, { source: 'snapshot' }>,
): Extract<CampaignRecoveryStepDecision, { action: 'rediscover' | 'attached' }>
export function resolveCampaignRecoveryStep(
  input: Extract<CampaignRecoveryStepInput, { source: 'live-terminal' }>,
): Extract<CampaignRecoveryStepDecision, { action: 'rediscover' }>
export function resolveCampaignRecoveryStep(
  input: Extract<CampaignRecoveryStepInput, { source: 'discovery' }>,
): Extract<
  CampaignRecoveryStepDecision,
  { action: 'ready' | 'attach' | 'select' }
>
export function resolveCampaignRecoveryStep(
  input: CampaignRecoveryStepInput,
): CampaignRecoveryStepDecision {
  if (input.source === 'live-terminal') {
    return { action: 'rediscover' }
  }

  if (input.source === 'snapshot') {
    return input.terminal
      ? { action: 'rediscover' }
      : { action: 'attached', run: input.run }
  }

  if (input.runs.length === 0) {
    return { action: 'ready' }
  }
  if (input.runs.length === 1) {
    return { action: 'attach', run: input.runs[0]! }
  }
  return { action: 'select', runs: input.runs }
}

/** Returns the highest valid persisted event ID included in a recovery snapshot. */
export function getCampaignRecoveryEventWatermark(
  events: readonly { id: unknown }[],
): number | null {
  let watermark: number | null = null

  for (const event of events) {
    if (
      typeof event.id === 'number' &&
      Number.isSafeInteger(event.id) &&
      event.id > 0 &&
      (watermark === null || event.id > watermark)
    ) {
      watermark = event.id
    }
  }

  return watermark
}

/** Reports whether a buffered relay event was already applied by recovery. */
export function isRecoveredRelayEventOverlap(
  persistedEventId: number | null,
  recoveredThroughEventId: number | null,
): boolean {
  return (
    persistedEventId !== null &&
    recoveredThroughEventId !== null &&
    persistedEventId <= recoveredThroughEventId
  )
}

/**
 * Determines whether an event terminates a run because of an unrecoverable
 * failure.
 *
 * @param eventType - The normalized orchestrator event type.
 * @returns Whether the event marks the campaign as aborted.
 */
function isReplayAbortEvent(eventType: string | null): boolean {
  return (
    eventType === 'CAMPAIGN_ERROR_FROM_SERVICE' ||
    eventType === 'CAMPAIGN_ERROR_SCHEMA' ||
    eventType === 'UNKNOWN_ERROR'
  )
}

/**
 * Determines whether an event marks a campaign run as successfully complete.
 *
 * @param eventType - The normalized orchestrator event type.
 * @returns Whether the event is a successful terminal event.
 */
function isReplayCompleteEvent(eventType: string | null): boolean {
  return (
    eventType === 'CAMPAIGN_COMPLETE' ||
    eventType === 'CAMPAIGN_END' ||
    eventType === 'CAMPAIGN_SUCCESS'
  )
}

/**
 * Returns the persisted canonical campaign identity.
 *
 * @param campaign - Current CampaignModel data.
 * @returns The non-empty campaign ID, or null when it is unavailable.
 */
export function getCampaignRecoveryIdentity(
  campaign: CampaignModel | undefined,
): string | null {
  if (!campaign) return null
  const identity = campaign.id
  return typeof identity === 'string' && identity ? identity : null
}

/**
 * Loads every active run page for the current user and exact campaign ID.
 *
 * @param campaignId - Persisted campaign ID whose active runs are requested.
 * @param signal - Optional signal used to cancel pending requests.
 * @param fetcher - Fetch implementation, injectable for testing.
 * @returns All active runs returned by the paginated API.
 * @throws When the run-discovery API returns a non-success status.
 */
export async function discoverActiveCampaignRuns(
  campaignId: string,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<CampaignRun[]> {
  const runs: CampaignRun[] = []
  let offset = 0

  while (true) {
    const query = new URLSearchParams({
      campaign_id: campaignId,
      status: 'ACTIVE',
      offset: String(offset),
      limit: String(ACTIVE_RUN_PAGE_SIZE),
    })
    const response = await fetcher(`/api/v1/campaign/runs?${query}`, {
      signal,
    })
    if (!response.ok) {
      throw new Error(
        `Could not look up active campaign runs (HTTP ${response.status})`,
      )
    }
    const page = (await response.json()) as CampaignRun[]
    runs.push(...page)
    if (page.length < ACTIVE_RUN_PAGE_SIZE) break
    offset += page.length
  }

  return runs
}

/**
 * Loads the authoritative run and its ordered persisted recovery events.
 *
 * @param runId - Run ID to recover.
 * @param signal - Optional signal used to cancel the request.
 * @param fetcher - Fetch implementation, injectable for testing.
 * @returns The run metadata and events required to rebuild execution state.
 * @throws When the recovery API returns a non-success status.
 */
export async function fetchCampaignRecoverySnapshot(
  runId: string,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<CampaignRecoverySnapshot> {
  const response = await fetcher(
    `/api/v1/campaign/runs/${encodeURIComponent(runId)}/recovery`,
    { signal },
  )
  if (!response.ok) {
    throw new Error(`Could not restore campaign run (HTTP ${response.status})`)
  }
  return response.json() as Promise<CampaignRecoverySnapshot>
}

/**
 * Creates the initial execution state before historical events are replayed.
 *
 * @param executionNodeIds - Ordered IDs of nodes that participate in execution.
 * @returns An executing campaign with every execution node waiting.
 */
export function createCampaignExecutionReplayState(
  executionNodeIds: readonly string[],
): CampaignExecutionReplayState {
  return {
    campaignStatus: 'executing',
    nodeStatuses: Object.fromEntries(
      executionNodeIds.map((nodeId) => [nodeId, 'waiting' as NodeStatus]),
    ),
    nodeRunCounts: {},
    stepToNodeMap: {},
    nextExecutionNodeIndex: 0,
    eventCompletionCounts: {},
    terminal: false,
  }
}

/**
 * Applies one historical or live orchestrator event to execution state.
 * Exact run matching, step fallback mapping, and all campaign terminal rules
 * live here so replay and websocket delivery agree.
 *
 * @param state - Execution state immediately before the event.
 * @param relayEvent - Persisted or live orchestrator event to apply.
 * @param config - Run and node configuration used to map event task IDs.
 * @returns The resulting execution state, or the original state when the event
 * belongs to another run or the run is already terminal.
 */
export function reduceCampaignExecutionEvent(
  state: CampaignExecutionReplayState,
  relayEvent: CampaignRelayEvent,
  config: CampaignExecutionReplayConfig,
): CampaignExecutionReplayState {
  const { runId, eventType, taskId } = getCampaignRelayEventDetails(relayEvent)
  if (runId !== config.runId || state.terminal) return state

  const stepToNodeMap = { ...state.stepToNodeMap }
  let nodeId: string | null = null
  let nextExecutionNodeIndex = state.nextExecutionNodeIndex
  if (taskId && config.executionNodeIds.includes(taskId)) {
    nodeId = taskId
    stepToNodeMap[taskId] = taskId
  } else if (
    taskId &&
    !config.ignoredNodeIds?.includes(taskId) &&
    stepToNodeMap[taskId]
  ) {
    nodeId = stepToNodeMap[taskId]
  } else if (taskId && !config.ignoredNodeIds?.includes(taskId)) {
    nodeId = config.executionNodeIds[nextExecutionNodeIndex] ?? null
    if (nodeId) {
      stepToNodeMap[taskId] = nodeId
      nextExecutionNodeIndex += 1
    }
  }
  const nodeStatuses = { ...state.nodeStatuses }
  const nodeRunCounts = { ...state.nodeRunCounts }
  const eventCompletionCounts = { ...state.eventCompletionCounts }

  if (nodeId) {
    const currentStatus = nodeStatuses[nodeId]
    const eventSettings = config.eventSettingsByNodeId?.[nodeId]
    if (eventType === 'STEP_START') {
      if (
        currentStatus !== 'executing' &&
        currentStatus !== 'error' &&
        currentStatus !== 'aborted'
      ) {
        nodeRunCounts[nodeId] = (nodeRunCounts[nodeId] ?? 0) + 1
      }
      if (eventSettings?.mode === 'count' && currentStatus === 'complete') {
        delete eventCompletionCounts[nodeId]
        nodeStatuses[nodeId] = 'executing'
      } else if (currentStatus !== 'error' && currentStatus !== 'aborted') {
        nodeStatuses[nodeId] = 'executing'
      }
    } else if (
      (eventType === 'STEP_COMPLETE' || eventType === 'STEP_SUCCESS') &&
      currentStatus !== 'error' &&
      currentStatus !== 'aborted'
    ) {
      if (!eventSettings || eventSettings.mode === 'once') {
        nodeStatuses[nodeId] = 'complete'
      } else if (eventSettings.mode === 'persistent') {
        nodeStatuses[nodeId] = 'executing'
      } else {
        const completionCount = (eventCompletionCounts[nodeId] ?? 0) + 1
        eventCompletionCounts[nodeId] = completionCount
        nodeStatuses[nodeId] =
          completionCount >= (eventSettings.count ?? 1)
            ? 'complete'
            : 'executing'
      }
    } else if (
      (eventType === 'STEP_ERROR' || eventType === 'STEP_FAIL') &&
      currentStatus !== 'complete' &&
      currentStatus !== 'aborted'
    ) {
      nodeStatuses[nodeId] = 'error'
    } else if (
      eventType === 'CAMPAIGN_ERROR_FROM_SERVICE' ||
      eventType === 'CAMPAIGN_ERROR_SCHEMA'
    ) {
      nodeStatuses[nodeId] = 'error'
    }
  }

  if (isReplayAbortEvent(eventType)) {
    config.executionNodeIds.forEach((executionNodeId) => {
      const status = nodeStatuses[executionNodeId]
      if (status === 'executing' || status === 'waiting') {
        nodeStatuses[executionNodeId] = 'aborted'
      }
    })
  }

  const terminal =
    isReplayCompleteEvent(eventType) || isReplayAbortEvent(eventType)

  if (isReplayCompleteEvent(eventType)) {
    Object.entries(config.eventSettingsByNodeId ?? {}).forEach(
      ([eventNodeId, settings]) => {
        if (
          settings.mode === 'persistent' &&
          nodeStatuses[eventNodeId] !== 'error' &&
          nodeStatuses[eventNodeId] !== 'aborted'
        ) {
          nodeStatuses[eventNodeId] = 'complete'
        }
      },
    )
  }

  return {
    campaignStatus: terminal ? 'idle' : 'executing',
    nodeStatuses,
    nodeRunCounts,
    stepToNodeMap,
    nextExecutionNodeIndex,
    eventCompletionCounts,
    terminal,
  }
}

/**
 * Reconstructs execution state from the ordered events in a recovery snapshot.
 *
 * @param events - Persisted events in the order they were recorded.
 * @param config - Run and node configuration used while replaying events.
 * @returns State obtained by applying every event to the initial waiting state.
 */
export function replayCampaignRecoveryEvents(
  events: readonly CampaignRecoveryEvent[],
  config: CampaignExecutionReplayConfig,
): CampaignExecutionReplayState {
  return events.reduce((state, event) => {
    const payload = event.payload ?? {}
    const payloadTaskId = getCampaignRelayEventDetails(payload).taskId
    const payloadEvent =
      payload.event && typeof payload.event === 'object'
        ? (payload.event as Record<string, unknown>)
        : {}
    const relayEvent = {
      ...payload,
      campaign_id: payload.campaign_id ?? event.campaign_id,
      run_id: payload.run_id ?? event.run_id,
      event: {
        ...payloadEvent,
        event_type:
          payloadEvent.event_type ?? payload.event_type ?? event.event_type,
        task_id: payloadTaskId ?? event.step_id,
      },
    }
    return reduceCampaignExecutionEvent(state, relayEvent, config)
  }, createCampaignExecutionReplayState(config.executionNodeIds))
}

/**
 * Reconciles replayed node state with the authoritative persisted run status.
 *
 * @param state - State reconstructed from the persisted event stream.
 * @param runStatus - Current run status stored by the campaign service.
 * @returns The unchanged state for active runs, or terminal idle state for all
 * non-active runs, marking unfinished nodes aborted when applicable.
 */
export function reconcileCampaignRecoverySnapshot(
  state: CampaignExecutionReplayState,
  runStatus: CampaignRun['status'],
): CampaignExecutionReplayState {
  if (runStatus === 'ACTIVE') return state

  const nodeStatuses = { ...state.nodeStatuses }
  if (runStatus === 'ABORTED') {
    Object.entries(nodeStatuses).forEach(([nodeId, status]) => {
      if (status === 'waiting' || status === 'executing') {
        nodeStatuses[nodeId] = 'aborted'
      }
    })
  }

  return {
    ...state,
    campaignStatus: 'idle',
    nodeStatuses,
    terminal: true,
  }
}

/**
 * Maps an already-terminal recovery-stop response to a synthetic terminal event.
 *
 * @param response - Unvalidated response payload from the stop endpoint.
 * @returns The matching terminal event type, or null when no event is safe to
 * synthesize.
 */
export function getRecoveryStopTerminalEventType(
  response: unknown,
): CampaignRecoveryTerminalEventType | null {
  if (!response || typeof response !== 'object') return 'UNKNOWN_ERROR'

  const candidate = response as Record<string, unknown>
  if (candidate.status !== 'already_terminal') return 'UNKNOWN_ERROR'
  if (candidate.run_status === 'ABORTED') return 'UNKNOWN_ERROR'
  if (candidate.run_status === 'COMPLETED') return 'CAMPAIGN_COMPLETE'
  return null
}

/**
 * Returns the phase-specific reason a new campaign run cannot start.
 *
 * @param state - Current campaign recovery state.
 * @returns A user-facing disabled reason, or null when starting is allowed.
 */
export function getRecoveryRunDisabledReason(
  state: CampaignRecoveryState,
): string | null {
  switch (state.phase) {
    case 'checking':
      return 'Checking for an active campaign run'
    case 'selection-required':
      return 'Select the active campaign run to restore'
    case 'attaching':
      return 'Restoring the active campaign run'
    case 'attached':
      return 'Campaign is already running'
    case 'error':
      return 'Campaign recovery must succeed before starting another run'
    case 'ready':
      return null
  }
}

/**
 * Determines whether broker selection must remain fixed during recovery.
 *
 * @param state - Current campaign recovery state.
 * @returns Whether a recovered run is being restored, attached, or failed after
 * being identified.
 */
export function isRecoveryBrokerLocked(state: CampaignRecoveryState): boolean {
  return (
    state.phase === 'attaching' ||
    state.phase === 'attached' ||
    (state.phase === 'error' && Boolean(state.run))
  )
}
