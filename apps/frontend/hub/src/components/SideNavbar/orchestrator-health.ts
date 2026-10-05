export const ORCHESTRATOR_HEALTH_REFRESH_INTERVAL = 30_000

export type OrchestratorHealthStatus =
  | 'connected'
  | 'disconnected'
  | 'not_configured'

export type OrchestratorHealthDisplayStatus =
  | OrchestratorHealthStatus
  | 'checking'
  | 'unavailable'

export type OrchestratorHealthKey = readonly [string, string]

type OrchestratorHealthRevalidateOptions = {
  retryCount: number
  dedupe: boolean
}

type OrchestratorHealthRevalidator = (
  options: OrchestratorHealthRevalidateOptions,
) => unknown

type RetryScheduler = (callback: () => void, delay: number) => unknown

const HEALTH_STATUSES = new Set<OrchestratorHealthStatus>([
  'connected',
  'disconnected',
  'not_configured',
])

/**
 * Schedules an orchestrator health retry at the normal polling cadence.
 *
 * @param revalidate - SWR callback used to retry the active cache entry.
 * @param revalidateOptions - Retry metadata supplied by SWR.
 * @param schedule - Timer implementation, injectable for deterministic tests.
 */
export function scheduleOrchestratorHealthRetry(
  revalidate: OrchestratorHealthRevalidator,
  revalidateOptions: OrchestratorHealthRevalidateOptions,
  schedule: RetryScheduler = setTimeout,
): void {
  schedule(() => {
    void revalidate(revalidateOptions)
  }, ORCHESTRATOR_HEALTH_REFRESH_INTERVAL)
}

/**
 * Builds the cache key used to request an orchestrator's health status.
 *
 * @param brokerId - Broker whose orchestrator health endpoint should be queried.
 * @param orchestratorUrl - Configured orchestrator URL included in the key so
 *   cache entries change when the broker configuration changes.
 * @returns The request key, or `null` when no orchestrator URL is configured.
 */
export function getOrchestratorHealthKey(
  brokerId: string | number,
  orchestratorUrl?: string,
): OrchestratorHealthKey | null {
  if (!orchestratorUrl?.trim()) {
    return null
  }

  return [`/api/v1/brokers/${brokerId}/orchestrator-health`, orchestratorUrl]
}

/**
 * Extracts a recognized health status from an unknown API response.
 *
 * @param value - Untrusted response payload to validate.
 * @returns A supported health status, or `null` for malformed or unknown data.
 */
export function parseOrchestratorHealthResponse(
  value: unknown,
): OrchestratorHealthStatus | null {
  if (!value || typeof value !== 'object' || !('status' in value)) {
    return null
  }

  const status = value.status
  return typeof status === 'string' &&
    HEALTH_STATUSES.has(status as OrchestratorHealthStatus)
    ? (status as OrchestratorHealthStatus)
    : null
}

/**
 * Resolves the status shown in the UI from configuration and request state.
 *
 * An absent URL takes precedence over request failures, while failures take
 * precedence over a parsed health status.
 *
 * @param options - Orchestrator configuration and current health request state.
 * @returns The health status suitable for display in the navigation UI.
 */
export function deriveOrchestratorHealthStatus({
  orchestratorUrl,
  status,
  failed,
}: {
  orchestratorUrl?: string
  status?: OrchestratorHealthStatus
  failed: boolean
}): OrchestratorHealthDisplayStatus {
  if (!orchestratorUrl?.trim()) {
    return 'not_configured'
  }
  if (failed) {
    return 'unavailable'
  }
  return status ?? 'checking'
}
