import assert from 'node:assert/strict'
import test from 'node:test'

import {
  fetchActiveCampaignRuns,
  fetchActiveExperimentRuns,
  getBrokerLabel,
  getCampaignRunStatusPresentation,
  orderActiveExperimentRuns,
  type CampaignRun,
  type CampaignRunsFetcher,
} from './active-experiments.ts'

function makeRun(
  runId: string,
  status: CampaignRun['status'],
  runAt: string,
): CampaignRun {
  return {
    id: Number(runId.replace(/\D/g, '')) || 1,
    user_email: 'user@example.com',
    campaign_id: `campaign-${runId}`,
    run_id: runId,
    run_at: runAt,
    orchestrator_url: 'http://orchestrator',
    status,
    ended_at: status && status !== 'ACTIVE' ? runAt : null,
    campaign_name: `Campaign ${runId}`,
    broker_id: 1,
  }
}

test('maps campaign run statuses to the requested badge colors', () => {
  assert.deepEqual(getCampaignRunStatusPresentation('ACTIVE'), {
    color: 'green',
    label: 'ACTIVE',
  })
  assert.deepEqual(getCampaignRunStatusPresentation('COMPLETED'), {
    color: 'green',
    label: 'COMPLETED',
  })
  assert.deepEqual(getCampaignRunStatusPresentation('ABORTED'), {
    color: 'red',
    label: 'ABORTED',
  })
})

test('resolves broker labels for numeric and string broker identifiers', () => {
  const brokers = [
    { id: 1, label: 'Primary Broker' },
    { id: '2', label: 'Secondary Broker' },
  ]

  assert.equal(getBrokerLabel(brokers, 1), 'Primary Broker')
  assert.equal(getBrokerLabel(brokers, 2), 'Secondary Broker')
  assert.equal(getBrokerLabel(brokers, 3), 'Unknown broker')
  assert.equal(getBrokerLabel(brokers, null), 'Unknown broker')
})

test('orders active runs first and limits recent terminal history', () => {
  const active = [
    makeRun('run-1', 'ACTIVE', '2026-07-09T10:00:00Z'),
    makeRun('run-2', 'ACTIVE', '2026-07-09T11:00:00Z'),
    makeRun('legacy', null, '2026-07-09T12:00:00Z'),
  ]
  const terminal = [
    makeRun('run-3', 'COMPLETED', '2026-07-09T09:00:00Z'),
    makeRun('run-4', 'ABORTED', '2026-07-09T12:00:00Z'),
  ]

  assert.deepEqual(
    orderActiveExperimentRuns(active, terminal, 1).map((run) => run.run_id),
    ['run-2', 'run-1', 'run-4'],
  )
})

test('pages through active runs and requests both terminal statuses', async () => {
  const requestedUrls: string[] = []
  const activePage = Array.from({ length: 100 }, (_, index) =>
    makeRun(
      `run-${index + 1}`,
      'ACTIVE',
      `2026-07-09T10:${String(index % 60).padStart(2, '0')}:00Z`,
    ),
  )
  const fetcher: CampaignRunsFetcher = async (url) => {
    requestedUrls.push(url)
    const params = new URL(url, 'http://localhost').searchParams
    const statuses = params.getAll('status')
    const offset = Number(params.get('offset'))
    const payload = statuses.includes('ACTIVE')
      ? offset === 0
        ? activePage
        : [makeRun('run-101', 'ACTIVE', '2026-07-09T12:00:00Z')]
      : [makeRun('run-102', 'COMPLETED', '2026-07-09T13:00:00Z')]

    return {
      ok: true,
      status: 200,
      json: async () => payload,
    }
  }

  const runs = await fetchActiveExperimentRuns('   ', fetcher)

  assert.equal(runs.filter((run) => run.status === 'ACTIVE').length, 101)
  assert.equal(runs.at(-1)?.run_id, 'run-102')
  assert.equal(
    requestedUrls.some(
      (url) =>
        url.includes('status=COMPLETED') && url.includes('status=ABORTED'),
    ),
    true,
  )
  assert.equal(
    requestedUrls.some((url) => url.includes('offset=100')),
    true,
  )
  assert.equal(
    requestedUrls.some((url) => url.includes('search=')),
    false,
  )
})

test('pages through current-user active runs without requesting history', async () => {
  const requestedUrls: string[] = []
  const firstPage = Array.from({ length: 100 }, (_, index) =>
    makeRun(
      `active-${index + 1}`,
      'ACTIVE',
      `2026-07-09T10:${String(index % 60).padStart(2, '0')}:00Z`,
    ),
  )
  const fetcher: CampaignRunsFetcher = async (url) => {
    requestedUrls.push(url)
    const offset = Number(
      new URL(url, 'http://localhost').searchParams.get('offset'),
    )
    return {
      ok: true,
      status: 200,
      json: async () =>
        offset === 0
          ? firstPage
          : [makeRun('terminal', 'COMPLETED', '2026-07-09T12:00:00Z')],
    }
  }

  const runs = await fetchActiveCampaignRuns(fetcher)

  assert.equal(runs.length, 100)
  assert.equal(requestedUrls.length, 2)
  for (const url of requestedUrls) {
    const params = new URL(url, 'http://localhost').searchParams
    assert.deepEqual(params.getAll('status'), ['ACTIVE'])
  }
  assert.equal(
    new URL(requestedUrls[1], 'http://localhost').searchParams.get('offset'),
    '100',
  )
})

test('searches all tracked statuses and orders matching runs for display', async () => {
  const requestedUrls: string[] = []
  const fetcher: CampaignRunsFetcher = async (url) => {
    requestedUrls.push(url)
    return {
      ok: true,
      status: 200,
      json: async () => [
        makeRun('run-1', 'COMPLETED', '2026-07-09T14:00:00Z'),
        makeRun('run-2', 'ACTIVE', '2026-07-09T10:00:00Z'),
        makeRun('run-3', 'ABORTED', '2026-07-09T11:00:00Z'),
        makeRun('run-4', 'ACTIVE', '2026-07-09T12:00:00Z'),
      ],
    }
  }

  const runs = await fetchActiveExperimentRuns('  Alpha & Beta  ', fetcher)
  const params = new URL(requestedUrls[0], 'http://localhost').searchParams

  assert.equal(requestedUrls.length, 1)
  assert.deepEqual(params.getAll('status'), ['ACTIVE', 'COMPLETED', 'ABORTED'])
  assert.equal(requestedUrls[0].includes('search=Alpha+%26+Beta'), true)
  assert.equal(params.get('search'), 'Alpha & Beta')
  assert.equal(params.get('offset'), '0')
  assert.equal(params.get('limit'), '100')
  assert.deepEqual(
    runs.map((run) => run.run_id),
    ['run-4', 'run-2', 'run-1', 'run-3'],
  )
})

test('throws a useful error when campaign run fetching fails', async () => {
  const fetcher: CampaignRunsFetcher = async () => ({
    ok: false,
    status: 503,
    json: async () => [],
  })

  await assert.rejects(
    fetchActiveExperimentRuns('', fetcher),
    /Campaign run request failed with HTTP 503/,
  )
})

test('returns an empty panel list when no tracked runs exist', async () => {
  const fetcher: CampaignRunsFetcher = async () => ({
    ok: true,
    status: 200,
    json: async () => [],
  })

  assert.deepEqual(await fetchActiveExperimentRuns('', fetcher), [])
})
