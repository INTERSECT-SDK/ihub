/* eslint-disable @typescript-eslint/no-require-imports -- Node's direct TS test runner needs require() for sibling TypeScript modules. */
const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')

const { canContinueCampaignStart } =
  require('./runControls.ts') as typeof import('./runControls')

type BrokerState = import('./runControls').CampaignStartBrokerState

type StartHarnessOptions = {
  brokerState: BrokerState
  afterMaterialization?: (brokerState: BrokerState) => void
  duringRelaySetup?: (brokerState: BrokerState) => void
}

async function runStartHarness({
  brokerState,
  afterMaterialization,
  duringRelaySetup,
}: StartHarnessOptions) {
  const startBrokerId = brokerState.brokerId!
  let relayConnections = 0
  let relayCloses = 0
  let campaignSubmissions = 0

  await Promise.resolve()
  afterMaterialization?.(brokerState)

  if (!canContinueCampaignStart(startBrokerId, brokerState)) {
    return { relayConnections, relayCloses, campaignSubmissions }
  }

  relayConnections += 1
  await Promise.resolve()
  duringRelaySetup?.(brokerState)

  if (!canContinueCampaignStart(startBrokerId, brokerState)) {
    relayCloses += 1
    return { relayConnections, relayCloses, campaignSubmissions }
  }

  campaignSubmissions += 1
  return { relayConnections, relayCloses, campaignSubmissions }
}

test('continues when the original broker remains selected and connected', async () => {
  assert.deepEqual(
    await runStartHarness({
      brokerState: { brokerId: 'broker-1', status: 'connected' },
    }),
    {
      relayConnections: 1,
      relayCloses: 0,
      campaignSubmissions: 1,
    },
  )
})

test('stops before relay setup when the broker disconnects during materialization', async () => {
  assert.deepEqual(
    await runStartHarness({
      brokerState: { brokerId: 'broker-1', status: 'connected' },
      afterMaterialization: (brokerState) => {
        brokerState.status = 'disconnected'
      },
    }),
    {
      relayConnections: 0,
      relayCloses: 0,
      campaignSubmissions: 0,
    },
  )
})

test('closes the relay when the broker disconnects during relay setup', async () => {
  assert.deepEqual(
    await runStartHarness({
      brokerState: { brokerId: 'broker-1', status: 'connected' },
      duringRelaySetup: (brokerState) => {
        brokerState.status = 'disconnected'
      },
    }),
    {
      relayConnections: 1,
      relayCloses: 1,
      campaignSubmissions: 0,
    },
  )
})

test('stops when the selected broker changes during preparation', async () => {
  assert.deepEqual(
    await runStartHarness({
      brokerState: { brokerId: 'broker-1', status: 'connected' },
      afterMaterialization: (brokerState) => {
        brokerState.brokerId = 'broker-2'
      },
    }),
    {
      relayConnections: 0,
      relayCloses: 0,
      campaignSubmissions: 0,
    },
  )
})
