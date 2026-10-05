/**
 * Campaign API helpers for starting campaign runs, building event stream URLs,
 * and validating campaign-related response messages.
 */
import type { CampaignModel } from '@ihub/utils/types/campaign'

export function buildCampaignEventWebSocketUrl(
  intersectServerId: string,
): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/api/v1/campaign/${encodeURIComponent(intersectServerId)}/events`
}

/**
 * Starts a campaign run by posting campaign data to the INTERSECT server.
 *
 * @param campaignData - The campaign configuration and input data to execute.
 * @param intersectServerId - The ID of the INTERSECT server that will run the campaign.
 * @throws {Error} If the HTTP response is not ok.
 */
export async function runCampaign(
  campaignData: CampaignModel,
  intersectServerId: string,
): Promise<unknown> {
  console.log('Running campaign...')

  return fetch(`/api/v1/campaign/${intersectServerId}/start`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(campaignData),
  }).then(async (res) => {
    if (!res.ok) {
      const detail = await res.text()
      throw new Error(
        detail ? `HTTP ${res.status}: ${detail}` : `HTTP ${res.status}`,
      )
    }
    return res.json()
  })
}

/**
 * Stops an active campaign run through the application backend proxy.
 *
 * @param intersectServerId - The selected INTERSECT broker ID.
 * @param campaignRunId - The active orchestrator run ID.
 * @throws {Error} If the HTTP response is not ok.
 */
export async function stopCampaign(
  intersectServerId: string,
  campaignRunId: string,
): Promise<unknown> {
  return fetch(
    `/api/v1/campaign/${encodeURIComponent(intersectServerId)}/stop/${encodeURIComponent(campaignRunId)}`,
    {
      method: 'POST',
    },
  ).then((res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const contentType = res.headers.get('content-type') ?? ''
    return contentType.includes('application/json') ? res.json() : undefined
  })
}

export type CampaignRelayReadyMessage = {
  message_type: 'relay_ready'
  broker_id: number
}

export function isCampaignRelayReadyMessage(
  message: unknown,
): message is CampaignRelayReadyMessage {
  if (!message || typeof message !== 'object') {
    return false
  }

  const candidate = message as Record<string, unknown>
  return (
    candidate.message_type === 'relay_ready' &&
    typeof candidate.broker_id === 'number'
  )
}

export function extractCampaignId(response: unknown): string | null {
  if (!response || typeof response !== 'object') {
    return null
  }

  const candidate = response as Record<string, unknown>
  const campaignId =
    candidate.campaign_id ?? candidate.campaignId ?? candidate.id
  return typeof campaignId === 'string' && campaignId ? campaignId : null
}

export function extractCampaignRunId(response: unknown): string | null {
  if (!response || typeof response !== 'object') {
    return null
  }

  const candidate = response as Record<string, unknown>
  const runId = candidate.run_id ?? candidate.runId
  return typeof runId === 'string' && runId ? runId : null
}
