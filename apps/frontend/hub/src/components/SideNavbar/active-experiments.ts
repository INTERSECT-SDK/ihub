/**
 * Data contracts and fetch helpers for the Active Experiments side panel.
 */

import { getStatusBadgeColor } from '../status-badge.ts'

export const campaignRunStatuses = ['ACTIVE', 'COMPLETED', 'ABORTED'] as const

export type CampaignRunStatus = (typeof campaignRunStatuses)[number]

export type CampaignRun = {
  id: number
  user_email: string | null
  campaign_id: string
  run_id: string
  run_at: string
  orchestrator_url: string | null
  status: CampaignRunStatus | null
  ended_at: string | null
  campaign_name: string | null
  broker_id: number | null
}

export type TrackedCampaignRun = CampaignRun & {
  status: CampaignRunStatus
}

export type BrokerLabelRecord = {
  id: number | string
  label: string
}

export type CampaignRunStatusPresentation = {
  color: string
  label: CampaignRunStatus
}

export type CampaignRunsFetcher = (
  url: string,
) => Promise<Pick<Response, 'json' | 'ok' | 'status'>>

const activePageSize = 100
const terminalHistoryLimit = 20
const searchResultLimit = 100

const statusPresentation: Record<
  CampaignRunStatus,
  CampaignRunStatusPresentation
> = {
  ACTIVE: { color: getStatusBadgeColor('ACTIVE'), label: 'ACTIVE' },
  COMPLETED: { color: getStatusBadgeColor('COMPLETED'), label: 'COMPLETED' },
  ABORTED: { color: getStatusBadgeColor('ABORTED'), label: 'ABORTED' },
}

/**
 * Determines whether an unknown value is a supported campaign run status.
 *
 * @param value - Value received from an untyped source.
 * @returns Whether `value` is a `CampaignRunStatus`.
 */
export function isCampaignRunStatus(
  value: unknown,
): value is CampaignRunStatus {
  return campaignRunStatuses.includes(value as CampaignRunStatus)
}

/**
 * Gets the label and color used to render a campaign run status.
 *
 * @param status - Supported campaign run status.
 * @returns Presentation metadata for `status`.
 */
export function getCampaignRunStatusPresentation(
  status: CampaignRunStatus,
): CampaignRunStatusPresentation {
  return statusPresentation[status]
}

/**
 * Resolves a persisted broker ID to its current display label.
 *
 * @param brokers - Brokers available to the current user.
 * @param brokerId - Persisted ID of the broker associated with the run.
 * @returns The matching broker label, or `Unknown broker` when unavailable.
 */
export function getBrokerLabel(
  brokers: readonly BrokerLabelRecord[],
  brokerId: number | null,
): string {
  if (brokerId === null) {
    return 'Unknown broker'
  }

  return (
    brokers.find((broker) => String(broker.id) === String(brokerId))?.label ||
    'Unknown broker'
  )
}

/**
 * Determines whether an untyped value contains the fields required to display
 * a tracked campaign run.
 *
 * @param value - Value received from an untyped API response.
 * @returns Whether `value` is a valid tracked campaign run.
 */
function isTrackedCampaignRun(value: unknown): value is TrackedCampaignRun {
  if (!value || typeof value !== 'object') {
    return false
  }

  const run = value as Partial<CampaignRun>
  return (
    typeof run.id === 'number' &&
    typeof run.campaign_id === 'string' &&
    typeof run.run_id === 'string' &&
    typeof run.run_at === 'string' &&
    isCampaignRunStatus(run.status)
  )
}

/**
 * Sorts tracked campaign runs by descending start time.
 *
 * @param a - First campaign run to compare.
 * @param b - Second campaign run to compare.
 * @returns A negative value when `b` is newer than `a`.
 */
function compareNewestFirst(a: TrackedCampaignRun, b: TrackedCampaignRun) {
  return Date.parse(b.run_at) - Date.parse(a.run_at)
}

/**
 * Places active runs before recent terminal runs and excludes invalid records.
 *
 * @param activeRuns - Runs returned from the active-runs request.
 * @param terminalRuns - Completed and aborted runs returned for history.
 * @param terminalLimit - Maximum number of terminal runs to include.
 * @returns Valid runs sorted newest-first within active and terminal groups.
 */
export function orderActiveExperimentRuns(
  activeRuns: readonly CampaignRun[],
  terminalRuns: readonly CampaignRun[],
  terminalLimit = terminalHistoryLimit,
): TrackedCampaignRun[] {
  const active = activeRuns
    .filter(
      (run): run is TrackedCampaignRun =>
        isTrackedCampaignRun(run) && run.status === 'ACTIVE',
    )
    .sort(compareNewestFirst)
  const terminal = terminalRuns
    .filter(
      (run): run is TrackedCampaignRun =>
        isTrackedCampaignRun(run) && run.status !== 'ACTIVE',
    )
    .sort(compareNewestFirst)
    .slice(0, terminalLimit)

  return [...active, ...terminal]
}

/**
 * Builds the paginated campaign-runs endpoint URL for a status filter.
 *
 * @param statuses - Run statuses to include in the request.
 * @param offset - Number of matching runs to skip.
 * @param limit - Maximum number of runs to request.
 * @param search - Optional search text to send to the API.
 * @returns Relative API URL with encoded query parameters.
 */
function buildCampaignRunsUrl(
  statuses: readonly CampaignRunStatus[],
  offset: number,
  limit: number,
  search?: string,
) {
  const params = new URLSearchParams({
    offset: String(offset),
    limit: String(limit),
  })
  statuses.forEach((status) => params.append('status', status))
  if (search) {
    params.set('search', search)
  }
  return `/api/v1/campaign/runs?${params.toString()}`
}

/**
 * Fetches a page of campaign runs and normalizes non-array API payloads.
 *
 * @param fetcher - Request function used to call the campaign-runs endpoint.
 * @param statuses - Run statuses to include in the request.
 * @param offset - Number of matching runs to skip.
 * @param limit - Maximum number of runs to request.
 * @param search - Optional search text to send to the API.
 * @returns Campaign runs in the response, or an empty array for non-array data.
 * @throws When the API responds with a non-success status.
 */
async function fetchCampaignRunPage(
  fetcher: CampaignRunsFetcher,
  statuses: readonly CampaignRunStatus[],
  offset: number,
  limit: number,
  search?: string,
): Promise<CampaignRun[]> {
  const response = await fetcher(
    buildCampaignRunsUrl(statuses, offset, limit, search),
  )
  if (!response.ok) {
    throw new Error(`Campaign run request failed with HTTP ${response.status}`)
  }

  const payload: unknown = await response.json()
  return Array.isArray(payload) ? (payload as CampaignRun[]) : []
}

/**
 * Loads the active-experiments list for the default view or a search query.
 *
 * @param search - Optional text used to filter campaign runs.
 * @param fetcher - Request function used to call the campaign-runs endpoint.
 * @returns Valid active runs followed by recent terminal runs.
 */
export async function fetchActiveExperimentRuns(
  search = '',
  fetcher: CampaignRunsFetcher = (url) => fetch(url),
): Promise<TrackedCampaignRun[]> {
  const normalizedSearch = search.trim()
  if (normalizedSearch) {
    const matchingRuns = await fetchCampaignRunPage(
      fetcher,
      campaignRunStatuses,
      0,
      searchResultLimit,
      normalizedSearch,
    )
    return orderActiveExperimentRuns(
      matchingRuns,
      matchingRuns,
      searchResultLimit,
    ).slice(0, searchResultLimit)
  }

  const activeRuns = await fetchActiveCampaignRuns(fetcher)

  const terminalRuns = await fetchCampaignRunPage(
    fetcher,
    ['COMPLETED', 'ABORTED'],
    0,
    terminalHistoryLimit,
  )
  return orderActiveExperimentRuns(activeRuns, terminalRuns)
}

/**
 * Loads every active campaign run owned by the signed-in user.
 *
 * @param fetcher - Request function used to call the campaign-runs endpoint.
 * @returns Valid active runs sorted newest-first.
 */
export async function fetchActiveCampaignRuns(
  fetcher: CampaignRunsFetcher = (url) => fetch(url),
): Promise<TrackedCampaignRun[]> {
  const activeRuns: CampaignRun[] = []
  let offset = 0

  while (true) {
    const page = await fetchCampaignRunPage(
      fetcher,
      ['ACTIVE'],
      offset,
      activePageSize,
    )
    activeRuns.push(...page)
    if (page.length < activePageSize) {
      break
    }
    offset += page.length
  }

  return orderActiveExperimentRuns(activeRuns, [], 0)
}
