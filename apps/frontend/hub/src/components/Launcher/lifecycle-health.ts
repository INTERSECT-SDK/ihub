import type { Broker, Capability } from '@/types.ts'

export type LauncherCapabilityStatus = 'online' | 'stale' | 'offline' | 'error'

const CAPABILITY_STALE_MS = 30 * 60 * 1000

export function getCapabilityStatus(
  capability: Pick<Capability, 'last_lifecycle_message' | 'lifecycle_error'>,
  brokerStatus: Broker['status'] | undefined,
  now = Date.now(),
): LauncherCapabilityStatus {
  if (capability.lifecycle_error) {
    return 'error'
  }

  if (brokerStatus !== 'connected') {
    return 'offline'
  }

  if (!capability.last_lifecycle_message) {
    return 'stale'
  }

  const lastLifecycleTimestamp = Date.parse(capability.last_lifecycle_message)

  if (Number.isNaN(lastLifecycleTimestamp)) {
    return 'stale'
  }

  return now - lastLifecycleTimestamp > CAPABILITY_STALE_MS ? 'stale' : 'online'
}

export function getCapabilityStatusTooltip(
  status: LauncherCapabilityStatus,
  lifecycleError: string | null,
): string | undefined {
  if (status === 'error') {
    return lifecycleError ?? undefined
  }

  if (status === 'stale') {
    return 'Stale — no lifecycle message has been received from this capability in the last 30 minutes.'
  }

  return undefined
}
