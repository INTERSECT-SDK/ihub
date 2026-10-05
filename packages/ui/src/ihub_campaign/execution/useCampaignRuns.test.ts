/* eslint-disable @typescript-eslint/no-require-imports -- Node runs these TypeScript tests directly. */
const assert: typeof import('node:assert/strict') = require('node:assert/strict')
const { test }: typeof import('node:test') = require('node:test')

const {
  fetchCampaignRunSnapshots,
  fetchHistoricalCampaignRecovery,
  selectHistoricalCampaignDocument,
  selectHistoricalCampaignRuns,
} = require('./useCampaignRuns.ts') as typeof import('./useCampaignRuns')

test('legacy history uses the executed canonical snapshot and cannot restore', () => {
  const snapshots = {
    schema_version: 1,
    run_id: 'run-1',
    captured_at: '2026-09-04T12:00:00Z',
    submitted_document_kind: 'icmp' as const,
    submitted_campaign: { campaignId: 'legacy', nodes: [], edges: [] },
    orchestrator_campaign: { id: 'canonical', task_groups: [] },
  }
  assert.deepEqual(selectHistoricalCampaignDocument(snapshots), {
    document: snapshots.orchestrator_campaign,
    replayDocument: snapshots.orchestrator_campaign,
    legacyOrigin: true,
    restoreAllowed: false,
  })
})

test('current history uses the submitted model and remains restorable', () => {
  const submittedCampaign = {
    id: 'submitted',
    task_groups: [
      {
        id: 'group-1',
        group_dependencies: [],
        tasks: [
          {
            id: 'code-1',
            hierarchy: 'code',
            capability: 'Code',
            task_dependencies: [],
            code_data: { name: 'Live inputs' },
          },
          {
            id: 'capability-1',
            hierarchy: 'capability',
            capability: 'Processor',
            task_dependencies: ['code-1'],
            manual_input_values: { temperature: 81 },
          },
          {
            id: 'visualization-1',
            hierarchy: 'visualization',
            capability: 'Visualization',
            task_dependencies: ['capability-1'],
          },
        ],
        ui_edges: [
          {
            id: 'code-capability-edge',
            source: 'code-1',
            target: 'capability-1',
            data: {
              data_mapping: [
                {
                  source_parameter: 'temperature',
                  target_parameter: 'temperature',
                },
              ],
            },
          },
          {
            id: 'capability-visualization-edge',
            source: 'capability-1',
            target: 'visualization-1',
          },
        ],
      },
    ],
  }
  const snapshots = {
    schema_version: 1,
    run_id: 'run-1',
    captured_at: '2026-09-04T12:00:00Z',
    submitted_document_kind: 'orchestrator_campaign' as const,
    submitted_campaign: submittedCampaign,
    orchestrator_campaign: {
      id: 'executed',
      task_groups: [
        {
          id: 'group-1',
          group_dependencies: [],
          tasks: [submittedCampaign.task_groups[0]!.tasks[1]],
          ui_edges: [],
        },
      ],
    },
  }
  assert.deepEqual(selectHistoricalCampaignDocument(snapshots), {
    document: snapshots.submitted_campaign,
    replayDocument: snapshots.orchestrator_campaign,
    legacyOrigin: false,
    restoreAllowed: true,
  })
})

test('historical run selection excludes active runs only', () => {
  const run = {
    id: 1,
    user_email: 'user@example.com',
    campaign_id: 'campaign-1',
    run_id: 'run-1',
    run_at: '2026-09-23T12:00:00Z',
    orchestrator_url: null,
    status: 'COMPLETED' as const,
    ended_at: '2026-09-23T12:01:00Z',
    campaign_name: 'Campaign',
    broker_id: 1,
  }
  const activeRun = {
    ...run,
    id: 2,
    run_id: 'active',
    status: 'ACTIVE' as const,
  }
  const abortedRun = {
    ...run,
    id: 3,
    run_id: 'aborted',
    status: 'ABORTED' as const,
  }
  const legacyRun = { ...run, id: 4, run_id: 'legacy', status: null }

  assert.deepEqual(
    selectHistoricalCampaignRuns([activeRun, run, abortedRun, legacyRun]),
    [run, abortedRun, legacyRun],
  )
  assert.deepEqual(selectHistoricalCampaignRuns(undefined), [])
})

test('fetchCampaignRunSnapshots requests encoded user-scoped run provenance', async () => {
  const calls: Array<{ input: string; signal?: AbortSignal }> = []
  const controller = new AbortController()
  const snapshot = {
    schema_version: 1,
    run_id: 'run/one',
    captured_at: '2026-09-01T12:00:00Z',
    submitted_document_kind: 'orchestrator_campaign' as const,
    submitted_campaign: { id: 'campaign-1' },
    orchestrator_campaign: { id: 'campaign-1', run_id: 'run/one' },
  }
  const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ input: String(input), signal: init?.signal ?? undefined })
    return new Response(JSON.stringify(snapshot), { status: 200 })
  }

  const result = await fetchCampaignRunSnapshots(
    'run/one',
    controller.signal,
    fetcher,
  )

  assert.deepEqual(result, snapshot)
  assert.deepEqual(calls, [
    {
      input: '/api/v1/campaign/runs/run%2Fone/snapshots',
      signal: controller.signal,
    },
  ])
})

test('fetchCampaignRunSnapshots explains missing legacy provenance', async () => {
  const fetcher = async () => new Response(null, { status: 404 })

  await assert.rejects(
    fetchCampaignRunSnapshots('legacy-run', undefined, fetcher),
    /Campaign provenance is unavailable for this run/,
  )
})

test('fetchHistoricalCampaignRecovery requests ordered run history', async () => {
  let requestedUrl = ''
  const expected = { run: { run_id: 'run/1' }, events: [] }

  const result = await fetchHistoricalCampaignRecovery(
    'run/1',
    undefined,
    (async (input: RequestInfo | URL) => {
      requestedUrl = String(input)
      return new Response(JSON.stringify(expected), { status: 200 })
    }) as typeof fetch,
  )

  assert.equal(requestedUrl, '/api/v1/campaign/runs/run%2F1/recovery')
  assert.deepEqual(result, expected)
})

test('fetchHistoricalCampaignRecovery reports retryable failures', async () => {
  await assert.rejects(
    fetchHistoricalCampaignRecovery(
      'run-1',
      undefined,
      (async () => new Response(null, { status: 503 })) as typeof fetch,
    ),
    /Could not load execution history \(HTTP 503\)/,
  )
})
