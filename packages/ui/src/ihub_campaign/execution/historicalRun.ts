import type { CampaignModel } from '@ihub/utils/types/campaign'

// Node's focused TypeScript test runner requires the imported file extension.
// @ts-expect-error TypeScript extensions are valid here because this package is no-emit.
import { getExecutableCampaignTasks } from '../model/selectors.ts'
import type { NodeStatus } from '../state/executionContext'
// @ts-expect-error TypeScript extensions are valid here because this package is no-emit.
import * as campaignEvents from './events.ts'
// @ts-expect-error TypeScript extensions are valid here because this package is no-emit.
import * as recoveryReplay from './recovery.ts'
import type {
  CampaignRecoveryEvent,
  CampaignRecoverySnapshot,
} from './recovery'

const {
  getCampaignRelayErrorMessage,
  getCampaignRelayEventDetails,
  isCampaignAbortEvent,
  isCampaignCompleteEvent,
} = campaignEvents
const { reconcileCampaignRecoverySnapshot, replayCampaignRecoveryEvents } =
  recoveryReplay

const historicalErrorEventTypes = new Set([
  'STEP_ERROR',
  'STEP_FAIL',
  'CAMPAIGN_ERROR_FROM_SERVICE',
  'CAMPAIGN_ERROR_SCHEMA',
  'UNKNOWN_ERROR',
])

const historicalErrorFallbacks: Record<string, string> = {
  STEP_ERROR: 'The task reported an error.',
  STEP_FAIL: 'The task failed.',
  CAMPAIGN_ERROR_FROM_SERVICE: 'A campaign service reported an error.',
  CAMPAIGN_ERROR_SCHEMA: 'The campaign did not match the required schema.',
  UNKNOWN_ERROR: 'The campaign stopped because of an unknown error.',
}

export type HistoricalRunError = {
  eventId: number
  timestamp: string
  eventType: string
  message: string
  scope: 'campaign' | 'task'
  stepId: string | null
  nodeId: string | null
  taskLabel: string | null
  runId: string
}

function buildReplayConfig(model: CampaignModel, runId: string) {
  const allTasks = model.task_groups.flatMap(({ tasks }) => tasks)
  const executableTasks = model.task_groups.flatMap((taskGroup) =>
    getExecutableCampaignTasks(taskGroup),
  )

  return {
    runId,
    executionNodeIds: executableTasks.map(({ id }) => id),
    ignoredNodeIds: allTasks
      .filter((task) => !executableTasks.includes(task))
      .map(({ id }) => id),
    eventSettingsByNodeId: Object.fromEntries(
      executableTasks
        .filter((task) => Boolean(task.event_name) && !task.operation_id)
        .map((task) => [
          task.id,
          {
            mode: task.event_mode ?? 'once',
            count: task.event_mode === 'count' ? (task.event_count ?? 1) : null,
          },
        ]),
    ),
  }
}

function getEventType(event: CampaignRecoveryEvent): string | null {
  if (event.event_type) return event.event_type
  return event.payload
    ? getCampaignRelayEventDetails(event.payload).eventType
    : null
}

function getStepId(event: CampaignRecoveryEvent): string | null {
  const payloadTaskId = event.payload
    ? getCampaignRelayEventDetails(event.payload).taskId
    : null
  if (payloadTaskId) return payloadTaskId
  const persistedStepId = event.step_id?.trim()
  return persistedStepId || null
}

function normalizeErrorMessage(event: CampaignRecoveryEvent): string | null {
  const direct = event.exception_message?.trim()
  if (direct) {
    const wrapped =
      (direct.startsWith("b'") && direct.endsWith("'")) ||
      (direct.startsWith('b"') && direct.endsWith('"'))
    return wrapped ? direct.slice(2, -1) : direct
  }
  return event.payload ? getCampaignRelayErrorMessage(event.payload) : null
}

function selectHistoricalEvents(
  recovery: CampaignRecoverySnapshot,
): CampaignRecoveryEvent[] {
  const orderedEvents = [...recovery.events].sort((left, right) => {
    const leftTimestamp = Date.parse(left.created_at)
    const rightTimestamp = Date.parse(right.created_at)
    const timeDifference = leftTimestamp - rightTimestamp
    return Number.isFinite(timeDifference) && timeDifference !== 0
      ? timeDifference
      : left.id - right.id
  })
  const endedAt = recovery.run.ended_at
    ? Date.parse(recovery.run.ended_at)
    : Number.NaN
  const boundedEvents =
    recovery.run.outcome && Number.isFinite(endedAt)
      ? orderedEvents.filter((event) => Date.parse(event.created_at) <= endedAt)
      : orderedEvents
  const terminalEventIndex = boundedEvents.findIndex((event) => {
    const eventType = getEventType(event)
    return isCampaignCompleteEvent(eventType) || isCampaignAbortEvent(eventType)
  })

  return terminalEventIndex === -1
    ? boundedEvents
    : boundedEvents.slice(0, terminalEventIndex + 1)
}

/** Replays a historical run without writing into the live execution provider. */
export function reconstructHistoricalNodeStatuses(
  model: CampaignModel,
  recovery: CampaignRecoverySnapshot,
): {
  nodeStatuses: Record<string, NodeStatus>
  nodeRunCounts: Record<string, number>
  stepToNodeMap: Record<string, string>
} {
  const replayed = replayCampaignRecoveryEvents(
    selectHistoricalEvents(recovery),
    buildReplayConfig(model, recovery.run.run_id),
  )
  const reconciled = reconcileCampaignRecoverySnapshot(
    replayed,
    recovery.run.status,
  )
  return {
    nodeStatuses: reconciled.nodeStatuses,
    nodeRunCounts: reconciled.nodeRunCounts,
    stepToNodeMap: reconciled.stepToNodeMap,
  }
}

/** Builds the sanitized presentation errors for an ordered recovery stream. */
export function extractHistoricalRunErrors(
  model: CampaignModel,
  recovery: CampaignRecoverySnapshot,
  stepToNodeMap: Record<string, string>,
): HistoricalRunError[] {
  const tasks = model.task_groups.flatMap(({ tasks }) => tasks)
  const taskById = new Map(tasks.map((task) => [task.id, task]))
  const selectedEvents = selectHistoricalEvents(recovery)

  return selectedEvents
    .filter((event) => {
      const eventType = getEventType(event)
      return eventType !== null && historicalErrorEventTypes.has(eventType)
    })
    .map((event) => {
      const eventType = getEventType(event)!
      const stepId = getStepId(event)
      const nodeId = stepId
        ? taskById.has(stepId)
          ? stepId
          : (stepToNodeMap[stepId] ?? null)
        : null
      const task = nodeId ? taskById.get(nodeId) : undefined
      const taskLabel = task
        ? task.event_name || task.operation_id || task.capability || task.id
        : null

      return {
        eventId: event.id,
        timestamp: event.created_at,
        eventType,
        message:
          normalizeErrorMessage(event) ??
          historicalErrorFallbacks[eventType] ??
          'The campaign reported an error.',
        scope: nodeId ? 'task' : 'campaign',
        stepId,
        nodeId,
        taskLabel,
        runId: recovery.run.run_id,
      }
    })
}
