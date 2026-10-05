import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { DiscoveredLauncherCapability } from './useLauncherCapabilities.ts'
import { groupLauncherCapabilitiesByBroker } from './launcher-capability-groups.ts'

function capability(
  name: string,
  uniqueId: string,
  brokerId: number | null,
  brokerLabel: string | null,
): DiscoveredLauncherCapability {
  return {
    label: name,
    name: uniqueId,
    capabilityName: name,
    serviceId: Number(uniqueId.split('-')[0]),
    brokerId,
    brokerLabel,
    lifecycleError: null,
    icon: null,
    view: null,
    status: 'online',
  }
}

describe('groupLauncherCapabilitiesByBroker', () => {
  it('groups shuffled input into canonical broker and capability order', () => {
    const capabilities = [
      capability('Zulu', '4-z', null, null),
      capability('Mystery', '5-m', 99, null),
      capability('bravo', '2-b', 20, 'Beta broker'),
      capability('alpha', '1-z', 10, 'Alpha broker'),
      capability('Alpha', '1-a', 10, 'Alpha broker'),
      capability('charlie', '3-c', 20, 'Beta broker'),
    ]

    const groups = groupLauncherCapabilitiesByBroker(capabilities)

    assert.deepEqual(
      groups.map((group) => ({
        key: group.key,
        label: group.label,
        capabilities: group.capabilities.map((item) => item.name),
      })),
      [
        {
          key: 'broker-10',
          label: 'Alpha broker',
          capabilities: ['1-a', '1-z'],
        },
        {
          key: 'broker-20',
          label: 'Beta broker',
          capabilities: ['2-b', '3-c'],
        },
        {
          key: 'unknown',
          label: 'Unknown broker',
          capabilities: ['5-m', '4-z'],
        },
      ],
    )
  })

  it('uses broker ID to break ties between equal labels', () => {
    const groups = groupLauncherCapabilitiesByBroker([
      capability('Second', '2-b', 10, 'Shared'),
      capability('First', '1-a', 2, 'shared'),
    ])

    assert.deepEqual(
      groups.map((group) => group.key),
      ['broker-2', 'broker-10'],
    )
  })

  it('uses one unknown group when either broker identity field is missing', () => {
    const groups = groupLauncherCapabilitiesByBroker([
      capability('Missing label', '1-a', 10, null),
      capability('Missing ID', '2-b', null, 'Broker without an ID'),
    ])

    assert.deepEqual(
      groups.map((group) => ({
        key: group.key,
        label: group.label,
        brokerId: group.brokerId,
        capabilities: group.capabilities.map((item) => item.name),
      })),
      [
        {
          key: 'unknown',
          label: 'Unknown broker',
          brokerId: null,
          capabilities: ['2-b', '1-a'],
        },
      ],
    )
  })

  it('does not mutate the discovered capability array', () => {
    const first = capability('Zulu', '1-z', 1, 'Broker')
    const second = capability('Alpha', '1-a', 1, 'Broker')
    const capabilities = Object.freeze([first, second])

    const groups = groupLauncherCapabilitiesByBroker(capabilities)

    assert.deepEqual(capabilities, [first, second])
    assert.deepEqual(groups[0]?.capabilities, [second, first])
  })
})
