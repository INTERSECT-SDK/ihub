import type { NodeStatus } from '../state/executionContext'

export type CampaignRelayEvent = Record<string, unknown>

export type CampaignRelayEventDetails = {
  campaignId: string | null
  runId: string | null
  eventType: string | null
  taskId: string | null
  persistedEventId: number | null
}

export type CampaignExecutionNode = {
  id: string
  type?: string | null
}

function getFirstUsableIdentifier(...candidates: unknown[]): string | null {
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined) continue
    const identifier = String(candidate).trim()
    if (identifier) return identifier
  }
  return null
}

/**
 * Parses a websocket message into a relay event object when it looks like JSON.
 * Non-string, non-JSON, malformed JSON, and primitive JSON payloads are ignored
 * so keepalive or status text frames do not interrupt campaign execution.
 *
 * @param data - Raw `MessageEvent.data` received from the campaign relay socket.
 * @returns Parsed object payload, or `null` when the payload should be ignored.
 */
export function parseCampaignRelayPayload(
  data: unknown,
): CampaignRelayEvent | null {
  if (typeof data !== 'string') {
    return null
  }

  const trimmed = data.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return null
  }

  try {
    const parsed = JSON.parse(data)
    return parsed && typeof parsed === 'object'
      ? (parsed as CampaignRelayEvent)
      : null
  } catch {
    return null
  }
}

/**
 * Extracts the campaign, run, event, and task identifiers from a relay event.
 * Step identity accepts the orchestrator's supported `task_id`, `node_id`, or
 * `step_id` fields and normalizes numeric identifiers to strings.
 *
 * @param relayEvent - Parsed relay payload emitted by the campaign event stream.
 * @returns Normalized event details with `null` for missing or invalid fields.
 */
export function getCampaignRelayEventDetails(
  relayEvent: CampaignRelayEvent,
): CampaignRelayEventDetails {
  const campaignId =
    typeof relayEvent.campaign_id === 'string' ? relayEvent.campaign_id : null
  const runId = typeof relayEvent.run_id === 'string' ? relayEvent.run_id : null
  const nestedEvent =
    relayEvent.event && typeof relayEvent.event === 'object'
      ? (relayEvent.event as Record<string, unknown>)
      : null
  const eventType =
    typeof nestedEvent?.event_type === 'string'
      ? nestedEvent.event_type
      : typeof relayEvent.event_type === 'string'
        ? relayEvent.event_type
        : null
  const taskId = getFirstUsableIdentifier(
    nestedEvent?.task_id,
    nestedEvent?.node_id,
    nestedEvent?.step_id,
    relayEvent.task_id,
    relayEvent.node_id,
    relayEvent.step_id,
  )
  const persistedEventId =
    typeof relayEvent.ihub_event_id === 'number' &&
    Number.isSafeInteger(relayEvent.ihub_event_id) &&
    relayEvent.ihub_event_id > 0
      ? relayEvent.ihub_event_id
      : null

  return {
    campaignId,
    runId,
    eventType,
    taskId,
    persistedEventId,
  }
}

/** Returns the backend exception attached to a terminal relay event. */
export function getCampaignRelayErrorMessage(
  relayEvent: CampaignRelayEvent,
): string | null {
  const nestedEvent =
    relayEvent.event && typeof relayEvent.event === 'object'
      ? (relayEvent.event as Record<string, unknown>)
      : null
  const exceptionMessage =
    nestedEvent?.exception_message ?? relayEvent.exception_message

  if (typeof exceptionMessage !== 'string' || !exceptionMessage.trim()) {
    return null
  }

  const message = exceptionMessage.trim()
  const hasPythonBytesWrapper =
    (message.startsWith("b'") && message.endsWith("'")) ||
    (message.startsWith('b"') && message.endsWith('"'))

  return hasPythonBytesWrapper ? message.slice(2, -1) : message
}

/**
 * Determines whether an event belongs to the active run and campaign filters.
 * A known run must match exactly. An omitted campaign ID remains acceptable,
 * but an explicit campaign ID must agree with the active campaign.
 *
 * @param activeCampaignId - Campaign ID returned by the start request, if any.
 * @param relayEvent - Parsed relay payload to evaluate.
 * @returns `true` when the event should be handled by the current execution.
 */
export function shouldHandleCampaignRelayEvent(
  activeCampaignId: string | null,
  activeRunId: string | null,
  relayEvent: CampaignRelayEvent,
): boolean {
  const eventRunId =
    typeof relayEvent.run_id === 'string' ? relayEvent.run_id : null
  const eventCampaignId =
    typeof relayEvent.campaign_id === 'string' ? relayEvent.campaign_id : null

  if (activeRunId && eventRunId !== activeRunId) {
    return false
  }

  if (
    activeCampaignId &&
    eventCampaignId &&
    eventCampaignId !== activeCampaignId
  ) {
    return false
  }

  return true
}

/**
 * Maps orchestrator step lifecycle event types to UI node execution statuses.
 *
 * @param eventType - Relay event type such as `STEP_START` or `STEP_COMPLETE`.
 * @returns Matching node status, or `null` for events that do not update nodes.
 */
export function getNodeStatusForCampaignEvent(
  eventType: string | null,
): NodeStatus | null {
  if (eventType === 'STEP_START') {
    return 'executing'
  }

  if (eventType === 'STEP_COMPLETE' || eventType === 'STEP_SUCCESS') {
    return 'complete'
  }

  if (eventType === 'STEP_ERROR' || eventType === 'STEP_FAIL') {
    return 'error'
  }

  return null
}

/**
 * Determines whether a relay event is a campaign-level terminal abort.
 *
 * @param eventType - Relay event type extracted from the payload.
 * @returns `true` when the campaign should abort executing capability nodes.
 */
export function isCampaignAbortEvent(eventType: string | null): boolean {
  return (
    eventType === 'CAMPAIGN_ERROR_FROM_SERVICE' ||
    eventType === 'CAMPAIGN_ERROR_SCHEMA' ||
    eventType === 'UNKNOWN_ERROR'
  )
}

/**
 * Determines whether an abort event belongs to the active or stopped run.
 * Run ID matching is preferred; before the UI has recorded any run ID, campaign
 * ID matching keeps immediate terminal aborts tied to the current execution.
 *
 * @param input - Event details and campaign/run IDs tracked by the UI.
 * @returns `true` when the terminal abort should be handled by this execution.
 */
export function shouldHandleCampaignAbortEvent({
  eventType,
  eventCampaignId,
  eventRunId,
  activeCampaignId,
  activeRunId,
  stoppedRunId,
}: {
  eventType: string | null
  eventCampaignId: string | null
  eventRunId: string | null
  activeCampaignId: string | null
  activeRunId: string | null
  stoppedRunId: string | null
}): boolean {
  if (!isCampaignAbortEvent(eventType)) {
    return false
  }

  const trackedRunIds = [activeRunId, stoppedRunId].filter(
    (runId): runId is string => Boolean(runId),
  )
  if (eventRunId && trackedRunIds.some((runId) => runId === eventRunId)) {
    return true
  }

  if (trackedRunIds.length > 0) {
    return false
  }

  return Boolean(
    eventCampaignId && activeCampaignId && eventCampaignId === activeCampaignId,
  )
}

/**
 * Finds executable nodes that should be marked aborted after a terminal abort.
 *
 * @param input - Rendered campaign nodes and current execution statuses.
 * @returns Capability node IDs whose badges should move from executing to aborted.
 */
export function getExecutingCapabilityNodeIdsToAbort({
  nodes,
  nodeStatuses,
}: {
  nodes: readonly CampaignExecutionNode[]
  nodeStatuses: Record<string, NodeStatus>
}): string[] {
  return nodes
    .filter(
      (node) =>
        (node.type === 'capability' || node.type === 'event') &&
        (nodeStatuses[node.id] === 'executing' ||
          nodeStatuses[node.id] === 'waiting'),
    )
    .map((node) => node.id)
}

/**
 * Determines whether a relay event is a campaign-level terminal completion.
 *
 * @param eventType - Relay event type extracted from the payload.
 * @returns `true` when the campaign should leave executing state.
 */
export function isCampaignCompleteEvent(eventType: string | null): boolean {
  return (
    eventType === 'CAMPAIGN_COMPLETE' ||
    eventType === 'CAMPAIGN_END' ||
    eventType === 'CAMPAIGN_SUCCESS'
  )
}

export type ResolveCampaignRelayNodeIdInput = {
  taskId: string | null
  currentNodeIds: readonly string[]
  ignoredNodeIds?: readonly string[]
  stepToNodeMap: Record<string, string>
  executionNodeOrder: readonly string[]
  nextExecutionNodeIndex: number
}

export type ResolveCampaignRelayNodeIdResult = {
  nodeId: string | null
  nextExecutionNodeIndex: number
}

/**
 * Resolves a relay task or step ID to the React Flow node that should be marked.
 * Direct node IDs are used first, previous step mappings are reused, and unknown
 * task IDs fall back to the next capability node in execution order.
 *
 * @param input - Current node IDs plus mutable step mapping and fallback index.
 * @returns Resolved node ID and the next fallback index to persist.
 */
export function resolveCampaignRelayNodeId({
  taskId,
  currentNodeIds,
  ignoredNodeIds = [],
  stepToNodeMap,
  executionNodeOrder,
  nextExecutionNodeIndex,
}: ResolveCampaignRelayNodeIdInput): ResolveCampaignRelayNodeIdResult {
  if (!taskId) {
    return {
      nodeId: null,
      nextExecutionNodeIndex,
    }
  }

  if (currentNodeIds.includes(taskId)) {
    stepToNodeMap[taskId] = taskId
    return {
      nodeId: taskId,
      nextExecutionNodeIndex,
    }
  }

  if (ignoredNodeIds.includes(taskId)) {
    return {
      nodeId: null,
      nextExecutionNodeIndex,
    }
  }

  const existingStepMapping = stepToNodeMap[taskId]
  if (existingStepMapping) {
    return {
      nodeId: existingStepMapping,
      nextExecutionNodeIndex,
    }
  }

  const fallbackNodeId = executionNodeOrder[nextExecutionNodeIndex]
  if (!fallbackNodeId) {
    return {
      nodeId: null,
      nextExecutionNodeIndex,
    }
  }

  stepToNodeMap[taskId] = fallbackNodeId
  return {
    nodeId: fallbackNodeId,
    nextExecutionNodeIndex: nextExecutionNodeIndex + 1,
  }
}
