import useSWR from 'swr'

import type {
  CampaignRecoverySnapshot,
  CampaignRun,
  CampaignRunSnapshots,
} from './recovery'

export function selectHistoricalCampaignDocument(
  snapshots: CampaignRunSnapshots,
): {
  document: Record<string, unknown>
  replayDocument: Record<string, unknown>
  legacyOrigin: boolean
  restoreAllowed: boolean
} {
  const legacyOrigin = snapshots.submitted_document_kind === 'icmp'
  return {
    document: legacyOrigin
      ? snapshots.orchestrator_campaign
      : snapshots.submitted_campaign,
    replayDocument: snapshots.orchestrator_campaign,
    legacyOrigin,
    restoreAllowed: !legacyOrigin,
  }
}

/** Selects terminal and legacy runs that belong in the historical run menu. */
export function selectHistoricalCampaignRuns(
  runs: readonly CampaignRun[] | undefined,
): CampaignRun[] {
  return runs?.filter(({ status }) => status !== 'ACTIVE') ?? []
}

async function fetchCampaignRuns(url: string): Promise<CampaignRun[]> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Could not load campaign runs (HTTP ${response.status})`)
  }
  return response.json() as Promise<CampaignRun[]>
}

export function useCampaignRuns(campaignIdentity: string | null) {
  const query = campaignIdentity
    ? new URLSearchParams({
        campaign_id: campaignIdentity,
        offset: '0',
        limit: '100',
      })
    : null

  return useSWR<CampaignRun[]>(
    query ? `/api/v1/campaign/runs?${query}` : null,
    fetchCampaignRuns,
  )
}

export async function fetchCampaignRunSnapshots(
  runId: string,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<CampaignRunSnapshots> {
  const response = await fetcher(
    `/api/v1/campaign/runs/${encodeURIComponent(runId)}/snapshots`,
    { signal },
  )
  if (!response.ok) {
    throw new Error(
      response.status === 404
        ? 'Campaign provenance is unavailable for this run.'
        : `Could not load campaign provenance (HTTP ${response.status})`,
    )
  }
  return response.json() as Promise<CampaignRunSnapshots>
}

export async function fetchHistoricalCampaignRecovery(
  runId: string,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<CampaignRecoverySnapshot> {
  const response = await fetcher(
    `/api/v1/campaign/runs/${encodeURIComponent(runId)}/recovery`,
    { signal },
  )
  if (!response.ok) {
    throw new Error(
      `Could not load execution history (HTTP ${response.status})`,
    )
  }
  return response.json() as Promise<CampaignRecoverySnapshot>
}
