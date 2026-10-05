/** Provides types and utilities for loading, selecting, and formatting campaign event logs. */

import type { CampaignRun } from './recovery'

export const EVENT_LOG_PAGE_SIZE = 100

export type CampaignEventLog = {
  id: number
  campaign_id: string
  run_id: string | null
  step_id: string | null
  created_at: string
  event_type: string | null
  payload: Record<string, unknown> | null
}

export type EventLogPageOptions = {
  beforeId?: number
  afterId?: number
  limit?: number
}

export type EventLogRefreshSignals = Record<string, number>

export type EventLogRunSelection = {
  campaignIdentity: string | null
  runId: string | null
}

export type EventLogRunSelectionAction =
  | { type: 'CAMPAIGN_CHANGED'; campaignIdentity: string | null }
  | { type: 'RUN_SELECTED'; runId: string }

/** Builds the authenticated exact-run, exact-step event-log page URL. */
export function buildEventLogUrl(
  runId: string,
  stepId: string,
  options: EventLogPageOptions = {},
): string {
  const query = new URLSearchParams({
    step_id: stepId,
    limit: String(options.limit ?? EVENT_LOG_PAGE_SIZE),
  })
  if (options.beforeId !== undefined) {
    query.set('before_id', String(options.beforeId))
  }
  if (options.afterId !== undefined) {
    query.set('after_id', String(options.afterId))
  }
  return `/api/v1/campaign/runs/${encodeURIComponent(runId)}/events?${query}`
}

/** Loads one persisted event page for an Event node. */
export async function fetchEventLogs(
  runId: string,
  stepId: string,
  options: EventLogPageOptions = {},
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<CampaignEventLog[]> {
  const response = await fetcher(buildEventLogUrl(runId, stepId, options), {
    signal,
  })
  if (!response.ok) {
    throw new Error(`Could not load event logs (HTTP ${response.status})`)
  }
  return response.json() as Promise<CampaignEventLog[]>
}

/** Selects the newest persisted step-completion event regardless of input order. */
export function selectLatestStepCompleteEvent(
  events: readonly CampaignEventLog[],
): CampaignEventLog | null {
  let latestEvent: CampaignEventLog | null = null

  for (const event of events) {
    if (
      event.event_type === 'STEP_COMPLETE' &&
      (latestEvent === null || event.id > latestEvent.id)
    ) {
      latestEvent = event
    }
  }

  return latestEvent
}

/** Loads the newest bounded page and returns its latest step completion. */
export async function fetchLatestStepCompleteEvent(
  runId: string,
  stepId: string,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<CampaignEventLog | null> {
  const events = await fetchEventLogs(runId, stepId, {}, signal, fetcher)
  return selectLatestStepCompleteEvent(events)
}

/** Creates the run-and-step key used to route persisted relay notifications. */
export function buildEventLogSignalKey(runId: string, stepId: string): string {
  return `${runId}\u0000${stepId}`
}

/** Records the newest persisted event ID without disturbing unrelated steps. */
export function recordEventLogRefreshSignal(
  signals: EventLogRefreshSignals,
  runId: string,
  stepId: string,
  eventId: number,
): EventLogRefreshSignals {
  const key = buildEventLogSignalKey(runId, stepId)
  if ((signals[key] ?? 0) >= eventId) return signals
  return { ...signals, [key]: eventId }
}

/** Merges cursor pages by persisted ID while retaining ascending order. */
export function mergeEventLogPages(
  current: readonly CampaignEventLog[],
  incoming: readonly CampaignEventLog[],
): CampaignEventLog[] {
  const byId = new Map<number, CampaignEventLog>()
  for (const event of current) byId.set(event.id, event)
  for (const event of incoming) byId.set(event.id, event)
  return [...byId.values()].sort((left, right) => left.id - right.id)
}

/** Loads the current user's newest persisted run for a campaign. */
export async function fetchLatestCampaignRun(
  campaignId: string,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<CampaignRun | null> {
  const query = new URLSearchParams({
    campaign_id: campaignId,
    offset: '0',
    limit: '1',
  })
  const response = await fetcher(`/api/v1/campaign/runs?${query}`, { signal })
  if (!response.ok) {
    throw new Error(
      `Could not look up the latest campaign run (HTTP ${response.status})`,
    )
  }
  const runs = (await response.json()) as CampaignRun[]
  return runs[0] ?? null
}

/** Keeps the selected log run until a new run or campaign replaces it. */
export function reduceEventLogRunSelection(
  state: EventLogRunSelection,
  action: EventLogRunSelectionAction,
): EventLogRunSelection {
  if (action.type === 'RUN_SELECTED') {
    return { ...state, runId: action.runId }
  }
  if (action.campaignIdentity === state.campaignIdentity) return state
  return { campaignIdentity: action.campaignIdentity, runId: null }
}

/** Formats the complete orchestrator `payload.event` value as JSON. */
export function formatEventPayload(
  payload: CampaignEventLog['payload'],
): string | null {
  if (!payload || !Object.hasOwn(payload, 'event')) return null
  const formatted = JSON.stringify(payload.event, null, 2)
  return formatted ?? null
}
