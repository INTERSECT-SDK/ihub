/* eslint-disable @typescript-eslint/no-require-imports -- Node's direct TS test runner needs require() for the sibling .ts helper without changing package module settings. */
const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')

const {
  extractCampaignId,
  extractCampaignRunId,
  isCampaignRelayReadyMessage,
  runCampaign,
  stopCampaign,
} = require('./actions.ts') as typeof import('./actions')

type CampaignModel = import('@ihub/utils/types/campaign').CampaignModel

test('runCampaign posts the complete CampaignModel document', async (t) => {
  const originalFetch = globalThis.fetch
  const fetchCalls: Array<{
    input: Parameters<typeof fetch>[0]
    init: Parameters<typeof fetch>[1]
  }> = []
  const campaignData = {
    id: 'campaign-model',
    run_id: 'run-1',
    name: 'Campaign.icmp',
    user: 'owner',
    description: '',
    task_groups: [
      {
        id: 'group-1',
        group_dependencies: [],
        objectives: [],
        tasks: [
          {
            id: 'capability-1',
            hierarchy: 'org.example',
            capability: 'Executable capability',
            operation_id: 'run',
            event_name: null,
            task_dependencies: [],
            task_objectives: null,
          },
        ],
      },
    ],
    objectives: null,
    inputs: [],
    outputs: [],
  } as CampaignModel

  globalThis.fetch = (async (input, init) => {
    fetchCalls.push({ input, init })
    return {
      ok: true,
      status: 200,
      json: async () => ({ campaign_id: campaignData.id }),
    } as Response
  }) as typeof fetch

  t.after(() => {
    globalThis.fetch = originalFetch
  })

  await runCampaign(campaignData, 'broker-1')

  assert.equal(fetchCalls.length, 1)
  assert.equal(String(fetchCalls[0]?.input), '/api/v1/campaign/broker-1/start')
  assert.equal(fetchCalls[0]?.init?.method, 'POST')
  assert.deepEqual(JSON.parse(String(fetchCalls[0]?.init?.body)), campaignData)
})

test('isCampaignRelayReadyMessage detects relay readiness payloads', () => {
  assert.equal(
    isCampaignRelayReadyMessage({ message_type: 'relay_ready', broker_id: 42 }),
    true,
  )
  assert.equal(
    isCampaignRelayReadyMessage({ message_type: 'other', broker_id: 42 }),
    false,
  )
  assert.equal(isCampaignRelayReadyMessage(null), false)
})

test('extractCampaignId supports common response shapes', () => {
  assert.equal(extractCampaignId({ campaign_id: 'abc' }), 'abc')
  assert.equal(extractCampaignId({ campaignId: 'def' }), 'def')
  assert.equal(extractCampaignId({ id: 'ghi' }), 'ghi')
  assert.equal(extractCampaignId({ run_id: 'jkl' }), null)
  assert.equal(extractCampaignId({ runId: 'mno' }), null)
  assert.equal(extractCampaignId('pqr'), null)
  assert.equal(extractCampaignId({}), null)
})

test('extractCampaignRunId supports common response shapes', () => {
  assert.equal(extractCampaignRunId({ run_id: 'run-1' }), 'run-1')
  assert.equal(extractCampaignRunId({ runId: 'run-2' }), 'run-2')
  assert.equal(extractCampaignRunId({ campaign_id: 'campaign-1' }), null)
  assert.equal(extractCampaignRunId('run-3'), null)
  assert.equal(extractCampaignRunId({}), null)
})

test('stopCampaign posts to the backend stop route', async (t) => {
  const originalFetch = globalThis.fetch
  const fetchCalls: Array<{
    input: Parameters<typeof fetch>[0]
    init: Parameters<typeof fetch>[1]
  }> = []

  globalThis.fetch = (async (input, init) => {
    fetchCalls.push({ input, init })
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ stopped: true }),
    } as unknown as Response
  }) as typeof fetch

  t.after(() => {
    globalThis.fetch = originalFetch
  })

  const result = await stopCampaign('broker-1', 'run-1')

  assert.deepEqual(result, { stopped: true })
  assert.equal(fetchCalls.length, 1)
  assert.equal(
    String(fetchCalls[0]?.input),
    '/api/v1/campaign/broker-1/stop/run-1',
  )
  assert.equal(fetchCalls[0]?.init?.method, 'POST')
})

test('stopCampaign encodes broker and campaign path parameters', async (t) => {
  const originalFetch = globalThis.fetch
  const fetchCalls: Array<{
    input: Parameters<typeof fetch>[0]
    init: Parameters<typeof fetch>[1]
  }> = []

  globalThis.fetch = (async (input, init) => {
    fetchCalls.push({ input, init })
    return {
      ok: true,
      status: 204,
      headers: { get: () => null },
      json: async () => ({}),
    } as unknown as Response
  }) as typeof fetch

  t.after(() => {
    globalThis.fetch = originalFetch
  })

  await stopCampaign('broker 1/alpha', 'run/one?x=1')

  assert.equal(
    String(fetchCalls[0]?.input),
    '/api/v1/campaign/broker%201%2Falpha/stop/run%2Fone%3Fx%3D1',
  )
})

test('stopCampaign throws on non-OK responses', async (t) => {
  const originalFetch = globalThis.fetch

  globalThis.fetch = (async () => {
    return {
      ok: false,
      status: 503,
      headers: { get: () => 'application/json' },
      json: async () => ({ detail: 'unavailable' }),
    } as unknown as Response
  }) as typeof fetch

  t.after(() => {
    globalThis.fetch = originalFetch
  })

  await assert.rejects(() => stopCampaign('broker-1', 'run-1'), /HTTP 503/)
})
