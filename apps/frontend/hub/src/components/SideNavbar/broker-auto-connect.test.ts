import assert from 'node:assert/strict'
import test from 'node:test'

import type { Broker } from '@ihub/utils/types/campaign'

import { shouldAutoConnectBroker } from './broker-auto-connect.ts'

function makeBroker(overrides: Partial<Broker>): Broker {
  return {
    id: 1,
    label: 'Broker',
    hostIP: '127.0.0.1',
    port: 1883,
    protocol: 'mqtt5.0',
    ...overrides,
  }
}

test('skips auto-connect when the broker disables auto-connect', () => {
  assert.equal(
    shouldAutoConnectBroker(
      makeBroker({
        status: 'disconnected',
        autoConnectEnabled: false,
      }),
    ),
    false,
  )
})

test('auto-connects disconnected brokers when flag is true or missing', () => {
  assert.equal(
    shouldAutoConnectBroker(
      makeBroker({
        status: 'disconnected',
        autoConnectEnabled: true,
      }),
    ),
    true,
  )
  assert.equal(
    shouldAutoConnectBroker(makeBroker({ status: 'disconnected' })),
    true,
  )
})

test('skips auto-connect for connected brokers', () => {
  assert.equal(
    shouldAutoConnectBroker(
      makeBroker({
        status: 'connected',
        autoConnectEnabled: true,
      }),
    ),
    false,
  )
})
