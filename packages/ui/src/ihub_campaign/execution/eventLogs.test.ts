/* eslint-disable @typescript-eslint/no-require-imports -- Node runs these TypeScript tests directly. */
const assert: typeof import('node:assert/strict') = require('node:assert/strict')
const { test }: typeof import('node:test') = require('node:test')

const {
  buildEventLogSignalKey,
  buildEventLogUrl,
  fetchEventLogs,
  fetchLatestStepCompleteEvent,
  fetchLatestCampaignRun,
  formatEventPayload,
  mergeEventLogPages,
  recordEventLogRefreshSignal,
  reduceEventLogRunSelection,
  selectLatestStepCompleteEvent,
} = require('./eventLogs.ts') as typeof import('./eventLogs')

test('buildEventLogUrl encodes the run and step identifiers', () => {
  assert.equal(
    buildEventLogUrl('run/one', 'event node/one'),
    '/api/v1/campaign/runs/run%2Fone/events?step_id=event+node%2Fone&limit=100',
  )
})

test('buildEventLogUrl adds older and newer persisted-ID cursors', () => {
  assert.equal(
    buildEventLogUrl('run-1', 'step-1', { beforeId: 41, limit: 25 }),
    '/api/v1/campaign/runs/run-1/events?step_id=step-1&limit=25&before_id=41',
  )
  assert.equal(
    buildEventLogUrl('run-1', 'step-1', { afterId: 41 }),
    '/api/v1/campaign/runs/run-1/events?step_id=step-1&limit=100&after_id=41',
  )
})

test('fetchEventLogs loads the exact run and step URL', async () => {
  const calls: Array<{ input: string; signal: AbortSignal | undefined }> = []
  const controller = new AbortController()
  const fetcher = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    calls.push({ input: String(input), signal: init?.signal ?? undefined })
    return new Response(
      JSON.stringify([
        {
          id: 17,
          campaign_id: 'campaign-1',
          run_id: 'run-1',
          step_id: 'step-1',
          created_at: '2026-08-17T12:00:00Z',
          payload: { event: { value: 1 } },
        },
      ]),
      { status: 200 },
    )
  }) as typeof fetch

  const events = await fetchEventLogs(
    'run-1',
    'step-1',
    {},
    controller.signal,
    fetcher,
  )

  assert.equal(events.length, 1)
  assert.deepEqual(calls, [
    {
      input: '/api/v1/campaign/runs/run-1/events?step_id=step-1&limit=100',
      signal: controller.signal,
    },
  ])
})

test('selectLatestStepCompleteEvent selects the highest persisted completion id', () => {
  const event = (id: number, eventType: string) => ({
    id,
    campaign_id: 'campaign-1',
    run_id: 'run-1',
    step_id: 'step-1',
    created_at: `2026-08-17T12:00:${id.toString().padStart(2, '0')}Z`,
    event_type: eventType,
    payload: { event: { id } },
  })

  const latest = selectLatestStepCompleteEvent([
    event(8, 'STEP_COMPLETE'),
    event(12, 'STEP_START'),
    event(10, 'STEP_COMPLETE'),
    event(4, 'STEP_COMPLETE'),
  ])

  assert.equal(latest?.id, 10)
  assert.equal(
    selectLatestStepCompleteEvent([
      event(9, 'STEP_START'),
      event(11, 'STEP_ERROR'),
    ]),
    null,
  )
})

test('fetchLatestStepCompleteEvent uses the exact run-step page and forwards cancellation', async () => {
  const calls: Array<{ input: string; signal: AbortSignal | undefined }> = []
  const controller = new AbortController()
  const fetcher = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    calls.push({ input: String(input), signal: init?.signal ?? undefined })
    return new Response(
      JSON.stringify([
        {
          id: 21,
          campaign_id: 'campaign-1',
          run_id: 'run/one',
          step_id: 'step/one',
          created_at: '2026-08-17T12:00:00Z',
          event_type: 'STEP_COMPLETE',
          payload: { event: { payload: '{"value":21}' } },
        },
      ]),
      { status: 200 },
    )
  }) as typeof fetch

  const event = await fetchLatestStepCompleteEvent(
    'run/one',
    'step/one',
    controller.signal,
    fetcher,
  )

  assert.equal(event?.id, 21)
  assert.deepEqual(calls, [
    {
      input:
        '/api/v1/campaign/runs/run%2Fone/events?step_id=step%2Fone&limit=100',
      signal: controller.signal,
    },
  ])
})

test('formatEventPayload preserves object, scalar, null, and missing values', () => {
  assert.equal(
    formatEventPayload({ event: { nested: [1, true] } }),
    '{\n  "nested": [\n    1,\n    true\n  ]\n}',
  )
  assert.equal(formatEventPayload({ event: 'ready' }), '"ready"')
  assert.equal(formatEventPayload({ event: 4 }), '4')
  assert.equal(formatEventPayload({ event: null }), 'null')
  assert.equal(formatEventPayload({ other: 'value' }), null)
  assert.equal(formatEventPayload(null), null)
})

test('fetchLatestCampaignRun selects the newest campaign-scoped row', async () => {
  let requestedUrl = ''
  const fetcher = (async (input: string | URL | Request) => {
    requestedUrl = String(input)
    return new Response(
      JSON.stringify([
        {
          id: 2,
          user_email: 'owner@example.com',
          campaign_id: 'campaign/one',
          run_id: 'latest-run',
          run_at: '2026-08-17T12:00:00Z',
          orchestrator_url: null,
          status: 'ABORTED',
          ended_at: '2026-08-17T12:01:00Z',
          campaign_name: 'Campaign',
          broker_id: 1,
        },
      ]),
      { status: 200 },
    )
  }) as typeof fetch

  const run = await fetchLatestCampaignRun('campaign/one', undefined, fetcher)

  assert.equal(
    requestedUrl,
    '/api/v1/campaign/runs?campaign_id=campaign%2Fone&offset=0&limit=1',
  )
  assert.equal(run?.run_id, 'latest-run')
})

test('log run selection persists through terminal state until replaced', () => {
  const selected = reduceEventLogRunSelection(
    { campaignIdentity: 'campaign-1', runId: null },
    { type: 'RUN_SELECTED', runId: 'failed-or-aborted-run' },
  )

  assert.deepEqual(selected, {
    campaignIdentity: 'campaign-1',
    runId: 'failed-or-aborted-run',
  })
  assert.equal(
    reduceEventLogRunSelection(selected, {
      type: 'CAMPAIGN_CHANGED',
      campaignIdentity: 'campaign-1',
    }),
    selected,
  )
  assert.deepEqual(
    reduceEventLogRunSelection(selected, {
      type: 'RUN_SELECTED',
      runId: 'new-run',
    }),
    { campaignIdentity: 'campaign-1', runId: 'new-run' },
  )
})

test('campaign scope change clears the selected log run', () => {
  assert.deepEqual(
    reduceEventLogRunSelection(
      { campaignIdentity: 'campaign-1', runId: 'run-1' },
      { type: 'CAMPAIGN_CHANGED', campaignIdentity: 'campaign-2' },
    ),
    { campaignIdentity: 'campaign-2', runId: null },
  )
})

test('persisted refresh signals update only their exact run and step', () => {
  const first = recordEventLogRefreshSignal({}, 'run-1', 'step-a', 6)
  const duplicate = recordEventLogRefreshSignal(first, 'run-1', 'step-a', 6)
  const second = recordEventLogRefreshSignal(first, 'run-1', 'step-b', 7)

  assert.equal(first[buildEventLogSignalKey('run-1', 'step-a')], 6)
  assert.equal(first[buildEventLogSignalKey('run-1', 'step-b')], undefined)
  assert.equal(duplicate, first)
  assert.equal(second[buildEventLogSignalKey('run-1', 'step-a')], 6)
  assert.equal(second[buildEventLogSignalKey('run-1', 'step-b')], 7)
})

test('event log pages merge in persisted order without duplicates', () => {
  const event = (id: number) => ({
    id,
    campaign_id: 'campaign-1',
    run_id: 'run-1',
    step_id: 'step-1',
    created_at: `2026-08-17T12:00:0${id}Z`,
    event_type: 'STEP_COMPLETE',
    payload: { event: { id } },
  })

  assert.deepEqual(
    mergeEventLogPages(
      [event(3), event(4)],
      [event(1), event(2), event(3)],
    ).map(({ id }) => id),
    [1, 2, 3, 4],
  )
})
