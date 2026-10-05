import type { DiscoveredLauncherCapability } from './useLauncherCapabilities.ts'

export type LauncherBrokerGroup = {
  key: string
  label: string
  brokerId: number | null
  capabilities: DiscoveredLauncherCapability[]
}

const UNKNOWN_BROKER_KEY = 'unknown'
const UNKNOWN_BROKER_LABEL = 'Unknown broker'

function compareCaseInsensitive(left: string, right: string): number {
  return left.localeCompare(right, 'en', { sensitivity: 'base' })
}

/**
 * Builds a stable presentation order without changing the discovered list.
 */
export function groupLauncherCapabilitiesByBroker(
  capabilities: readonly DiscoveredLauncherCapability[],
): LauncherBrokerGroup[] {
  const groupsByBroker = new Map<string, LauncherBrokerGroup>()

  for (const capability of capabilities) {
    let key = UNKNOWN_BROKER_KEY
    let label = UNKNOWN_BROKER_LABEL
    let brokerId: number | null = null

    if (capability.brokerId !== null && capability.brokerLabel !== null) {
      key = `broker-${capability.brokerId}`
      label = capability.brokerLabel
      brokerId = capability.brokerId
    }

    const group = groupsByBroker.get(key)

    if (group) {
      group.capabilities.push(capability)
    } else {
      groupsByBroker.set(key, {
        key,
        label,
        brokerId,
        capabilities: [capability],
      })
    }
  }

  const groups = Array.from(groupsByBroker.values())

  for (const group of groups) {
    group.capabilities.sort((left, right) => {
      const nameComparison = compareCaseInsensitive(
        left.capabilityName,
        right.capabilityName,
      )

      return nameComparison || left.name.localeCompare(right.name, 'en')
    })
  }

  return groups.sort((left, right) => {
    if (left.key === UNKNOWN_BROKER_KEY) return 1
    if (right.key === UNKNOWN_BROKER_KEY) return -1

    const labelComparison = compareCaseInsensitive(left.label, right.label)

    return labelComparison || (left.brokerId ?? 0) - (right.brokerId ?? 0)
  })
}
