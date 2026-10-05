/* eslint-disable @typescript-eslint/no-require-imports -- Node's direct TS test runner needs require() for sibling TypeScript modules. */
const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')

const {
  createCampaignExecutionReplayState,
  discoverActiveCampaignRuns,
  getCampaignRecoveryEventWatermark,
  getCampaignRecoveryIdentity,
  getRecoveryStopTerminalEventType,
  getRecoveryRunDisabledReason,
  isRecoveredRelayEventOverlap,
  isRecoveryBrokerLocked,
  reconcileCampaignRecoverySnapshot,
  reduceCampaignExecutionEvent,
  replayCampaignRecoveryEvents,
  resolveCampaignRecoveryStep,
  shouldRetainCompletedCampaignDisplay,
} = require('./recovery.ts') as typeof import('./recovery')

function makeRun(index: number) {
  return {
    id: index,
    user_email: 'owner@example.com',
    campaign_id: 'campaign-1',
    run_id: `run-${index}`,
    run_at: '2026-08-11T12:00:00Z',
    orchestrator_url: 'http://orchestrator',
    status: 'ACTIVE' as const,
    ended_at: null,
    campaign_name: 'Campaign',
    broker_id: 7,
  }
}

test('derives recovery identity from CampaignModel documents', () => {
  assert.equal(
    getCampaignRecoveryIdentity({
      id: 'model-1',
      run_id: 'run-1',
      task_groups: [],
    } as never),
    'model-1',
  )
  assert.equal(getCampaignRecoveryIdentity(undefined), null)
})

test('active-run discovery pages until the complete current-user result is loaded', async () => {
  const requestedOffsets: string[] = []
  const firstPage = Array.from({ length: 100 }, (_, index) => makeRun(index))
  const secondPage = [makeRun(100)]
  const fetcher = async (input: string | URL | Request) => {
    const url = new URL(String(input), 'http://ihub')
    requestedOffsets.push(url.searchParams.get('offset') ?? '')
    const page = url.searchParams.get('offset') === '0' ? firstPage : secondPage
    return new Response(JSON.stringify(page), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  const runs = await discoverActiveCampaignRuns(
    'campaign with spaces',
    undefined,
    fetcher as typeof fetch,
  )

  assert.equal(runs.length, 101)
  assert.deepEqual(requestedOffsets, ['0', '100'])
})

test('terminal recovery snapshots require rediscovery before Run becomes ready', () => {
  const runA = makeRun(1)
  const runB = makeRun(2)
  const initialDiscovery = resolveCampaignRecoveryStep({
    source: 'discovery',
    runs: [runA, runB],
  })

  assert.deepEqual(initialDiscovery, {
    action: 'select',
    runs: [runA, runB],
  })
  assert.deepEqual(
    resolveCampaignRecoveryStep({
      source: 'snapshot',
      run: runA,
      terminal: true,
    }),
    { action: 'rediscover' },
  )
  assert.deepEqual(
    resolveCampaignRecoveryStep({
      source: 'discovery',
      runs: [runB],
    }),
    { action: 'attach', run: runB },
  )
})

test('live terminal events rediscover and attach another active run', () => {
  const runA = makeRun(1)
  const runB = makeRun(2)

  assert.deepEqual(
    resolveCampaignRecoveryStep({
      source: 'discovery',
      runs: [runA, runB],
    }),
    { action: 'select', runs: [runA, runB] },
  )
  assert.deepEqual(resolveCampaignRecoveryStep({ source: 'live-terminal' }), {
    action: 'rediscover',
  })
  assert.deepEqual(
    resolveCampaignRecoveryStep({ source: 'discovery', runs: [runB] }),
    { action: 'attach', run: runB },
  )
})

test('post-terminal discovery selects multiple runs and is ready only when none remain', () => {
  const runA = makeRun(1)
  const runB = makeRun(2)

  assert.deepEqual(
    resolveCampaignRecoveryStep({ source: 'discovery', runs: [] }),
    { action: 'ready' },
  )
  assert.deepEqual(
    resolveCampaignRecoveryStep({ source: 'discovery', runs: [runB] }),
    { action: 'attach', run: runB },
  )
  assert.deepEqual(
    resolveCampaignRecoveryStep({
      source: 'discovery',
      runs: [runA, runB],
    }),
    { action: 'select', runs: [runA, runB] },
  )
  assert.deepEqual(
    resolveCampaignRecoveryStep({
      source: 'snapshot',
      run: runA,
      terminal: false,
    }),
    { action: 'attached', run: runA },
  )
})

test('successful terminal display survives empty discovery and recovery retries', () => {
  const retainedAfterCompletion = shouldRetainCompletedCampaignDisplay({
    source: 'live-terminal',
    successful: true,
  })

  assert.equal(retainedAfterCompletion, true)
  assert.equal(
    shouldRetainCompletedCampaignDisplay({
      source: 'discovery',
      hasRetainedDisplay: retainedAfterCompletion,
      activeRunCount: 0,
    }),
    true,
  )
  assert.equal(
    shouldRetainCompletedCampaignDisplay({
      source: 'recovery-error',
      hasRetainedDisplay: retainedAfterCompletion,
    }),
    true,
  )
})

test('active-run attachment or selection replaces a completed display', () => {
  for (const activeRunCount of [1, 2]) {
    assert.equal(
      shouldRetainCompletedCampaignDisplay({
        source: 'discovery',
        hasRetainedDisplay: true,
        activeRunCount,
      }),
      false,
    )
  }
})

test('abort, remount snapshot, identity change, and new execution reset completed display', () => {
  assert.equal(
    shouldRetainCompletedCampaignDisplay({
      source: 'live-terminal',
      successful: false,
    }),
    false,
  )
  assert.equal(
    shouldRetainCompletedCampaignDisplay({ source: 'snapshot-terminal' }),
    false,
  )
  assert.equal(shouldRetainCompletedCampaignDisplay({ source: 'reset' }), false)
})

test('historical replay initializes waiting nodes and reconstructs task mappings', () => {
  const events = [
    {
      payload: {
        campaign_id: 'campaign-1',
        run_id: 'run-1',
        event: { event_type: 'STEP_START', task_id: 'orchestrator-step' },
      },
    },
    {
      payload: {
        campaign_id: 'campaign-1',
        run_id: 'run-1',
        event: {
          event_type: 'STEP_COMPLETE',
          task_id: 'orchestrator-step',
        },
      },
    },
  ]
  const state = replayCampaignRecoveryEvents(events as never, {
    runId: 'run-1',
    executionNodeIds: ['node-1', 'node-2'],
  })

  assert.deepEqual(state.nodeStatuses, {
    'node-1': 'complete',
    'node-2': 'waiting',
  })
  assert.deepEqual(state.nodeRunCounts, { 'node-1': 1 })
  assert.deepEqual(state.stepToNodeMap, { 'orchestrator-step': 'node-1' })
  assert.equal(state.nextExecutionNodeIndex, 1)
  assert.equal(state.terminal, false)
})

test('historical replay restores repeated task-group iterations', () => {
  const event = (id: number, eventType: string) => ({
    id,
    campaign_id: 'campaign-1',
    run_id: 'run-1',
    step_id: 'node-1',
    created_at: `2026-08-17T12:00:0${id}Z`,
    event_type: eventType,
    fields_to_populate: null,
    exception_message: null,
    payload: null,
  })
  const state = replayCampaignRecoveryEvents(
    [event(1, 'STEP_START'), event(2, 'STEP_COMPLETE'), event(3, 'STEP_START')],
    { runId: 'run-1', executionNodeIds: ['node-1'] },
  )

  assert.equal(state.nodeStatuses['node-1'], 'executing')
  assert.equal(state.nodeRunCounts['node-1'], 2)
})

test('historical replay supports legacy rows whose payload was not retained', () => {
  const state = replayCampaignRecoveryEvents(
    [
      {
        id: 1,
        campaign_id: 'campaign-1',
        run_id: 'run-1',
        step_id: 'node-1',
        created_at: '2026-08-11T12:00:00Z',
        event_type: 'STEP_COMPLETE',
        fields_to_populate: null,
        exception_message: null,
        payload: null,
      },
    ],
    { runId: 'run-1', executionNodeIds: ['node-1'] },
  )

  assert.equal(state.nodeStatuses['node-1'], 'complete')
})

test('historical replay preserves flat payload task identifiers', () => {
  for (const identifier of ['task_id', 'node_id', 'step_id'] as const) {
    const state = replayCampaignRecoveryEvents(
      [
        {
          id: 1,
          campaign_id: 'campaign-1',
          run_id: 'run-1',
          step_id: null,
          created_at: '2026-09-23T12:00:00Z',
          event_type: null,
          fields_to_populate: null,
          exception_message: null,
          payload: {
            campaign_id: 'campaign-1',
            run_id: 'run-1',
            event_type: 'STEP_COMPLETE',
            [identifier]: 'node-1',
          },
        },
      ],
      { runId: 'run-1', executionNodeIds: ['node-1'] },
    )

    assert.equal(
      state.nodeStatuses['node-1'],
      'complete',
      `${identifier} should resolve the completed node`,
    )
  }
})

test('historical replay uses the first non-empty payload identifier', () => {
  const payloads = [
    {
      event: {
        event_type: 'STEP_COMPLETE',
        task_id: ' ',
        node_id: 'node-1',
      },
    },
    {
      event: {
        event_type: 'STEP_COMPLETE',
        task_id: '',
        node_id: null,
        step_id: '   ',
      },
      task_id: 'node-1',
    },
    {
      event: { event_type: 'STEP_COMPLETE', task_id: 0 },
    },
  ]

  for (const [index, payload] of payloads.entries()) {
    const expectedNodeId = index === 2 ? '0' : 'node-1'
    const state = replayCampaignRecoveryEvents(
      [
        {
          id: index + 1,
          campaign_id: 'campaign-1',
          run_id: 'run-1',
          step_id: 'wrong-persisted-step',
          created_at: '2026-09-23T12:00:00Z',
          event_type: null,
          fields_to_populate: null,
          exception_message: null,
          payload: {
            campaign_id: 'campaign-1',
            run_id: 'run-1',
            ...payload,
          },
        },
      ],
      { runId: 'run-1', executionNodeIds: [expectedNodeId] },
    )

    assert.equal(state.nodeStatuses[expectedNodeId], 'complete')
  }
})

test('event replay honors once, count, and persistent completion modes', () => {
  const config = {
    runId: 'run-1',
    executionNodeIds: ['once', 'count', 'persistent'],
    eventSettingsByNodeId: {
      once: { mode: 'once' as const, count: null },
      count: { mode: 'count' as const, count: 2 },
      persistent: { mode: 'persistent' as const, count: null },
    },
  }
  let state = createCampaignExecutionReplayState(config.executionNodeIds)
  const complete = (taskId: string) => {
    state = reduceCampaignExecutionEvent(
      state,
      {
        run_id: 'run-1',
        event: { event_type: 'STEP_COMPLETE', task_id: taskId },
      },
      config,
    )
  }

  complete('once')
  complete('count')
  complete('persistent')
  assert.equal(state.nodeStatuses.once, 'complete')
  assert.equal(state.nodeStatuses.count, 'executing')
  assert.equal(state.nodeStatuses.persistent, 'executing')

  complete('count')
  assert.equal(state.nodeStatuses.count, 'complete')

  state = reduceCampaignExecutionEvent(
    state,
    { run_id: 'run-1', event: { event_type: 'CAMPAIGN_COMPLETE' } },
    config,
  )
  assert.equal(state.nodeStatuses.persistent, 'complete')
})

test('Persistent replay state stays constant as persisted event volume grows', () => {
  const config = {
    runId: 'run-1',
    executionNodeIds: ['persistent'],
    eventSettingsByNodeId: {
      persistent: { mode: 'persistent' as const, count: null },
    },
  }
  const makeEvent = (id: number) => ({
    id,
    campaign_id: 'campaign-1',
    run_id: 'run-1',
    step_id: 'persistent',
    created_at: '2026-08-17T12:00:00Z',
    event_type: 'STEP_COMPLETE',
    fields_to_populate: null,
    exception_message: null,
    payload: {
      campaign_id: 'campaign-1',
      run_id: 'run-1',
      event: { event_type: 'STEP_COMPLETE', task_id: 'persistent' },
    },
  })

  const oneEvent = replayCampaignRecoveryEvents([makeEvent(1)], config)
  const manyEvents = replayCampaignRecoveryEvents(
    Array.from({ length: 5000 }, (_, index) => makeEvent(index + 1)),
    config,
  )

  assert.equal(manyEvents.nodeStatuses.persistent, 'executing')
  assert.equal(Object.hasOwn(manyEvents, 'processedEventIds'), false)
  assert.deepEqual(manyEvents, oneEvent)
})

test('Count replay resets progress for each task-group iteration', () => {
  const config = {
    runId: 'run-1',
    executionNodeIds: ['count'],
    eventSettingsByNodeId: {
      count: { mode: 'count' as const, count: 2 },
    },
  }
  const event = (eventType: string, eventId: number) => ({
    run_id: 'run-1',
    ihub_event_id: eventId,
    event: { event_type: eventType, task_id: 'count' },
  })
  let state = createCampaignExecutionReplayState(config.executionNodeIds)

  state = reduceCampaignExecutionEvent(state, event('STEP_START', 1), config)
  assert.equal(state.nodeRunCounts.count, 1)
  state = reduceCampaignExecutionEvent(state, event('STEP_COMPLETE', 2), config)
  state = reduceCampaignExecutionEvent(state, event('STEP_COMPLETE', 3), config)
  assert.equal(state.eventCompletionCounts.count, 2)
  assert.equal(state.nodeStatuses.count, 'complete')

  state = reduceCampaignExecutionEvent(state, event('STEP_START', 4), config)
  assert.equal(state.eventCompletionCounts.count, undefined)
  assert.equal(state.nodeStatuses.count, 'executing')
  assert.equal(state.nodeRunCounts.count, 2)

  state = reduceCampaignExecutionEvent(state, event('STEP_COMPLETE', 5), config)
  assert.equal(state.eventCompletionCounts.count, 1)
  assert.equal(state.nodeStatuses.count, 'executing')

  state = reduceCampaignExecutionEvent(state, event('STEP_START', 6), config)
  assert.equal(state.eventCompletionCounts.count, 1)
  assert.equal(state.nodeStatuses.count, 'executing')
  assert.equal(state.nodeRunCounts.count, 2)

  state = reduceCampaignExecutionEvent(state, event('STEP_COMPLETE', 7), config)
  assert.equal(state.eventCompletionCounts.count, 2)
  assert.equal(state.nodeStatuses.count, 'complete')
})

test('snapshot and buffered relay events deduplicate Count completions by persisted identity', () => {
  const config = {
    runId: 'run-1',
    executionNodeIds: ['count'],
    eventSettingsByNodeId: {
      count: { mode: 'count' as const, count: 2 },
    },
  }
  const snapshotEvent = {
    id: 41,
    campaign_id: 'campaign-1',
    run_id: 'run-1',
    step_id: 'count',
    created_at: '2026-08-17T12:00:00Z',
    event_type: 'STEP_COMPLETE',
    fields_to_populate: null,
    exception_message: null,
    payload: {
      campaign_id: 'campaign-1',
      run_id: 'run-1',
      ihub_event_id: 999,
      event: { event_type: 'STEP_COMPLETE', task_id: 'count' },
    },
  }
  const replayed = replayCampaignRecoveryEvents([snapshotEvent], config)
  const watermark = getCampaignRecoveryEventWatermark([snapshotEvent])
  const duplicateEvent = {
    campaign_id: 'campaign-1',
    run_id: 'run-1',
    ihub_event_id: 41,
    event: { event_type: 'STEP_COMPLETE', task_id: 'count' },
  }
  const duplicate = isRecoveredRelayEventOverlap(
    duplicateEvent.ihub_event_id,
    watermark,
  )
    ? replayed
    : reduceCampaignExecutionEvent(replayed, duplicateEvent, config)

  assert.equal(replayed.eventCompletionCounts.count, 1)
  assert.equal(watermark, 41)
  assert.equal(duplicate, replayed)
  assert.equal(duplicate.eventCompletionCounts.count, 1)
  assert.equal(duplicate.nodeStatuses.count, 'executing')

  const nextEvent = {
    campaign_id: 'campaign-1',
    run_id: 'run-1',
    ihub_event_id: 42,
    event: { event_type: 'STEP_COMPLETE', task_id: 'count' },
  }
  assert.equal(
    isRecoveredRelayEventOverlap(nextEvent.ihub_event_id, watermark),
    false,
  )
  const secondCompletion = reduceCampaignExecutionEvent(
    duplicate,
    nextEvent,
    config,
  )

  assert.equal(secondCompletion.eventCompletionCounts.count, 2)
  assert.equal(secondCompletion.nodeStatuses.count, 'complete')
})

test('recovery overlap watermark ignores absent and invalid persisted IDs', () => {
  assert.equal(getCampaignRecoveryEventWatermark([]), null)
  assert.equal(
    getCampaignRecoveryEventWatermark([
      { id: null },
      { id: -1 },
      { id: 4.5 },
      { id: Number.MAX_SAFE_INTEGER + 1 },
      { id: 7 },
      { id: 12 },
      { id: 9 },
    ]),
    12,
  )
  assert.equal(isRecoveredRelayEventOverlap(null, 12), false)
  assert.equal(isRecoveredRelayEventOverlap(12, null), false)
  assert.equal(isRecoveredRelayEventOverlap(11, 12), true)
  assert.equal(isRecoveredRelayEventOverlap(12, 12), true)
  assert.equal(isRecoveredRelayEventOverlap(13, 12), false)
})

test('identity-less Count completions continue to be processed independently', () => {
  const config = {
    runId: 'run-1',
    executionNodeIds: ['count'],
    eventSettingsByNodeId: {
      count: { mode: 'count' as const, count: 2 },
    },
  }
  const completion = {
    run_id: 'run-1',
    event: { event_type: 'STEP_COMPLETE', task_id: 'count' },
  }
  const first = reduceCampaignExecutionEvent(
    createCampaignExecutionReplayState(config.executionNodeIds),
    completion,
    config,
  )
  const second = reduceCampaignExecutionEvent(first, completion, config)

  assert.equal(first.eventCompletionCounts.count, 1)
  assert.equal(first.nodeStatuses.count, 'executing')
  assert.equal(second.eventCompletionCounts.count, 2)
  assert.equal(second.nodeStatuses.count, 'complete')
})

test('duplicate task replay is idempotent and exact-run filtering rejects ambiguity', () => {
  const initial = createCampaignExecutionReplayState(['node-1', 'node-2'])
  const matchingEvent = {
    run_id: 'run-1',
    event: { event_type: 'STEP_START', task_id: 'step-1' },
  }
  const first = reduceCampaignExecutionEvent(initial, matchingEvent, {
    runId: 'run-1',
    executionNodeIds: ['node-1', 'node-2'],
  })
  const duplicate = reduceCampaignExecutionEvent(first, matchingEvent, {
    runId: 'run-1',
    executionNodeIds: ['node-1', 'node-2'],
  })
  const missingRun = reduceCampaignExecutionEvent(
    duplicate,
    { campaign_id: 'campaign-1', event: { event_type: 'STEP_COMPLETE' } },
    { runId: 'run-1', executionNodeIds: ['node-1', 'node-2'] },
  )

  assert.deepEqual(duplicate, first)
  assert.equal(duplicate.nodeRunCounts['node-1'], 1)
  assert.equal(duplicate.nextExecutionNodeIndex, 1)
  assert.equal(missingRun, duplicate)
})

test('a later start reopens a completed task for its next iteration', () => {
  const started = reduceCampaignExecutionEvent(
    createCampaignExecutionReplayState(['node-1']),
    {
      run_id: 'run-1',
      event: { event_type: 'STEP_START', task_id: 'step-1' },
    },
    { runId: 'run-1', executionNodeIds: ['node-1'] },
  )
  const complete = reduceCampaignExecutionEvent(
    started,
    {
      run_id: 'run-1',
      event: { event_type: 'STEP_COMPLETE', task_id: 'step-1' },
    },
    { runId: 'run-1', executionNodeIds: ['node-1'] },
  )
  const nextIteration = reduceCampaignExecutionEvent(
    complete,
    {
      run_id: 'run-1',
      event: { event_type: 'STEP_START', task_id: 'step-1' },
    },
    { runId: 'run-1', executionNodeIds: ['node-1'] },
  )

  assert.equal(nextIteration.nodeStatuses['node-1'], 'executing')
  assert.equal(nextIteration.nodeRunCounts['node-1'], 2)
})

test('all supported campaign errors abort pending work and become terminal', () => {
  for (const eventType of [
    'CAMPAIGN_ERROR_FROM_SERVICE',
    'CAMPAIGN_ERROR_SCHEMA',
    'UNKNOWN_ERROR',
  ]) {
    const state = reduceCampaignExecutionEvent(
      createCampaignExecutionReplayState(['node-1', 'node-2']),
      { run_id: 'run-1', event: { event_type: eventType } },
      { runId: 'run-1', executionNodeIds: ['node-1', 'node-2'] },
    )
    assert.equal(state.campaignStatus, 'idle')
    assert.equal(state.terminal, true)
    assert.deepEqual(state.nodeStatuses, {
      'node-1': 'aborted',
      'node-2': 'aborted',
    })
  }
})

test('service and schema campaign errors mark their resolved task as failed', () => {
  for (const eventType of [
    'CAMPAIGN_ERROR_FROM_SERVICE',
    'CAMPAIGN_ERROR_SCHEMA',
  ]) {
    const state = reduceCampaignExecutionEvent(
      createCampaignExecutionReplayState(['failed-node', 'pending-node']),
      {
        run_id: 'run-1',
        event: { event_type: eventType, task_id: 'opaque-step' },
      },
      {
        runId: 'run-1',
        executionNodeIds: ['failed-node', 'pending-node'],
      },
    )

    assert.equal(state.terminal, true)
    assert.deepEqual(state.stepToNodeMap, { 'opaque-step': 'failed-node' })
    assert.deepEqual(state.nodeStatuses, {
      'failed-node': 'error',
      'pending-node': 'aborted',
    })
  }
})

test('an aborted snapshot aborts only pending capability nodes', () => {
  const replayState = {
    ...createCampaignExecutionReplayState([
      'waiting-node',
      'executing-node',
      'complete-node',
      'error-node',
    ]),
    nodeStatuses: {
      'waiting-node': 'waiting' as const,
      'executing-node': 'executing' as const,
      'complete-node': 'complete' as const,
      'error-node': 'error' as const,
    },
  }

  const reconciled = reconcileCampaignRecoverySnapshot(replayState, 'ABORTED')

  assert.equal(reconciled.campaignStatus, 'idle')
  assert.equal(reconciled.terminal, true)
  assert.deepEqual(reconciled.nodeStatuses, {
    'waiting-node': 'aborted',
    'executing-node': 'aborted',
    'complete-node': 'complete',
    'error-node': 'error',
  })
})

test('a completed snapshot becomes terminal without aborting pending nodes', () => {
  const replayState = {
    ...createCampaignExecutionReplayState(['waiting-node', 'executing-node']),
    nodeStatuses: {
      'waiting-node': 'waiting' as const,
      'executing-node': 'executing' as const,
    },
  }

  const reconciled = reconcileCampaignRecoverySnapshot(replayState, 'COMPLETED')

  assert.equal(reconciled.campaignStatus, 'idle')
  assert.equal(reconciled.terminal, true)
  assert.deepEqual(reconciled.nodeStatuses, replayState.nodeStatuses)
})

test('active and legacy snapshot statuses follow authoritative terminal rules', () => {
  const replayState = createCampaignExecutionReplayState(['waiting-node'])

  assert.equal(
    reconcileCampaignRecoverySnapshot(replayState, 'ACTIVE'),
    replayState,
  )

  const legacyTerminal = reconcileCampaignRecoverySnapshot(replayState, null)
  assert.equal(legacyTerminal.campaignStatus, 'idle')
  assert.equal(legacyTerminal.terminal, true)
  assert.equal(legacyTerminal.nodeStatuses['waiting-node'], 'waiting')
})

test('recovery stop responses map only recognized outcomes to terminal events', () => {
  assert.equal(
    getRecoveryStopTerminalEventType({ status: 'stopped' }),
    'UNKNOWN_ERROR',
  )
  assert.equal(
    getRecoveryStopTerminalEventType({
      status: 'already_terminal',
      run_status: 'ABORTED',
    }),
    'UNKNOWN_ERROR',
  )
  assert.equal(
    getRecoveryStopTerminalEventType({
      status: 'already_terminal',
      run_status: 'COMPLETED',
    }),
    'CAMPAIGN_COMPLETE',
  )
  assert.equal(
    getRecoveryStopTerminalEventType({
      status: 'already_terminal',
      run_status: 'LEGACY_TERMINAL',
    }),
    null,
  )
})

test('recovery phases provide run gating and known-run broker locking', () => {
  const run = makeRun(1)
  assert.equal(
    getRecoveryRunDisabledReason({ phase: 'checking' }),
    'Checking for an active campaign run',
  )
  assert.equal(getRecoveryRunDisabledReason({ phase: 'ready' }), null)
  assert.equal(
    isRecoveryBrokerLocked({ phase: 'error', message: 'lookup failed' }),
    false,
  )
  assert.equal(
    isRecoveryBrokerLocked({ phase: 'error', message: 'attach failed', run }),
    true,
  )
})
