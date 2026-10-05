/* eslint-disable @typescript-eslint/no-require-imports -- Node's direct TS test runner needs require() for sibling .ts files without changing package module settings. */
const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')

const {
  getExecutingCapabilityNodeIdsToAbort,
  getCampaignRelayErrorMessage,
  getCampaignRelayEventDetails,
  getNodeStatusForCampaignEvent,
  isCampaignAbortEvent,
  isCampaignCompleteEvent,
  parseCampaignRelayPayload,
  resolveCampaignRelayNodeId,
  shouldHandleCampaignAbortEvent,
  shouldHandleCampaignRelayEvent,
} = require('./events.ts') as typeof import('./events')
const { extractCampaignId } =
  require('./actions.ts') as typeof import('./actions')

test('parseCampaignRelayPayload ignores non-JSON websocket payloads', () => {
  assert.equal(parseCampaignRelayPayload('connected'), null)
  assert.equal(parseCampaignRelayPayload('{invalid'), null)
  assert.equal(parseCampaignRelayPayload(42), null)
})

test('extracts backend errors from nested and top-level relay events', () => {
  assert.equal(
    getCampaignRelayErrorMessage({
      event: {
        exception_message: "b'Tried to call non-existent operation generate'",
      },
    }),
    'Tried to call non-existent operation generate',
  )
  assert.equal(
    getCampaignRelayErrorMessage({
      exception_message: 'Campaign failed',
    }),
    'Campaign failed',
  )
  assert.equal(getCampaignRelayErrorMessage({}), null)
})

test('parseCampaignRelayPayload returns object payloads', () => {
  assert.deepEqual(parseCampaignRelayPayload('{"campaign_id":"campaign-1"}'), {
    campaign_id: 'campaign-1',
  })
})

test('shouldHandleCampaignRelayEvent filters by active campaign id', () => {
  assert.equal(
    shouldHandleCampaignRelayEvent(null, null, { campaign_id: 'campaign-1' }),
    true,
  )
  assert.equal(
    shouldHandleCampaignRelayEvent('campaign-1', null, {
      campaign_id: 'campaign-1',
    }),
    true,
  )
  assert.equal(
    shouldHandleCampaignRelayEvent('campaign-1', null, {
      campaign_id: 'campaign-2',
    }),
    false,
  )
  assert.equal(shouldHandleCampaignRelayEvent('campaign-1', null, {}), true)
})

test('shouldHandleCampaignRelayEvent requires matching known run and campaign identities', () => {
  assert.equal(
    shouldHandleCampaignRelayEvent('campaign-1', 'run-1', {
      run_id: 'run-1',
      campaign_id: 'campaign-1',
    }),
    true,
  )

  assert.equal(
    shouldHandleCampaignRelayEvent('campaign-1', 'run-1', {
      run_id: 'run-1',
    }),
    true,
  )

  assert.equal(
    shouldHandleCampaignRelayEvent('campaign-1', 'run-1', {
      run_id: 'run-1',
      campaign_id: '',
    }),
    true,
  )

  assert.equal(
    shouldHandleCampaignRelayEvent('campaign-1', 'run-1', {
      run_id: 'run-1',
      campaign_id: 'campaign-2',
    }),
    false,
  )

  assert.equal(
    shouldHandleCampaignRelayEvent('campaign-1', 'run-1', {
      run_id: 'run-2',
      campaign_id: 'campaign-1',
    }),
    false,
  )

  assert.equal(
    shouldHandleCampaignRelayEvent('campaign-1', 'run-1', {
      campaign_id: 'campaign-1',
    }),
    false,
  )
})

test('buffered relay events can be replayed after campaign id extraction', () => {
  const activeCampaignId = extractCampaignId({ campaign_id: 'campaign-1' })
  const bufferedEvents = [
    { campaign_id: 'campaign-2' },
    { campaign_id: 'campaign-1' },
  ]

  const replayedEvents = bufferedEvents.filter((relayEvent) =>
    shouldHandleCampaignRelayEvent(activeCampaignId, null, relayEvent),
  )

  assert.deepEqual(replayedEvents, [{ campaign_id: 'campaign-1' }])
})

test('getCampaignRelayEventDetails extracts run, event, and task ids', () => {
  assert.deepEqual(
    getCampaignRelayEventDetails({
      campaign_id: 'campaign-1',
      run_id: 'run-1',
      ihub_event_id: 17,
      event: {
        event_type: 'STEP_START',
        step_id: 42,
      },
    }),
    {
      campaignId: 'campaign-1',
      runId: 'run-1',
      eventType: 'STEP_START',
      taskId: '42',
      persistedEventId: 17,
    },
  )
})

test('getCampaignRelayEventDetails falls back to flat task ids per field', () => {
  assert.equal(
    getCampaignRelayEventDetails({
      event: { event_type: 'STEP_COMPLETE' },
      node_id: 42,
    }).taskId,
    '42',
  )
})

test('getCampaignRelayEventDetails skips empty identifiers and preserves zero', () => {
  assert.equal(
    getCampaignRelayEventDetails({
      event: { task_id: '  ', node_id: 'nested-node' },
      task_id: 'flat-task',
    }).taskId,
    'nested-node',
  )
  assert.equal(
    getCampaignRelayEventDetails({
      event: { task_id: '', node_id: null, step_id: '   ' },
      task_id: 'flat-task',
    }).taskId,
    'flat-task',
  )
  assert.equal(
    getCampaignRelayEventDetails({ event: { task_id: 0 } }).taskId,
    '0',
  )
})

test('getNodeStatusForCampaignEvent maps step events to node statuses', () => {
  assert.equal(getNodeStatusForCampaignEvent('STEP_START'), 'executing')
  assert.equal(getNodeStatusForCampaignEvent('STEP_COMPLETE'), 'complete')
  assert.equal(getNodeStatusForCampaignEvent('STEP_SUCCESS'), 'complete')
  assert.equal(getNodeStatusForCampaignEvent('STEP_ERROR'), 'error')
  assert.equal(getNodeStatusForCampaignEvent('STEP_FAIL'), 'error')
  assert.equal(getNodeStatusForCampaignEvent('CAMPAIGN_COMPLETE'), null)
  assert.equal(getNodeStatusForCampaignEvent('UNKNOWN_ERROR'), null)
})

test('isCampaignCompleteEvent treats completion as campaign-level terminal', () => {
  assert.equal(isCampaignCompleteEvent('CAMPAIGN_COMPLETE'), true)
  assert.equal(isCampaignCompleteEvent('CAMPAIGN_END'), true)
  assert.equal(isCampaignCompleteEvent('CAMPAIGN_SUCCESS'), true)
  assert.equal(isCampaignCompleteEvent('STEP_COMPLETE'), false)
  assert.equal(getNodeStatusForCampaignEvent('CAMPAIGN_COMPLETE'), null)
})

test('isCampaignAbortEvent treats UNKNOWN_ERROR as campaign-level terminal abort', () => {
  assert.equal(isCampaignAbortEvent('UNKNOWN_ERROR'), true)
  assert.equal(isCampaignAbortEvent('STEP_ERROR'), false)
  assert.equal(getNodeStatusForCampaignEvent('UNKNOWN_ERROR'), null)
})

test('shouldHandleCampaignAbortEvent requires a matching active or stopped run id', () => {
  assert.equal(
    shouldHandleCampaignAbortEvent({
      eventType: 'UNKNOWN_ERROR',
      eventCampaignId: null,
      eventRunId: 'run-1',
      activeCampaignId: null,
      activeRunId: 'run-1',
      stoppedRunId: null,
    }),
    true,
  )

  assert.equal(
    shouldHandleCampaignAbortEvent({
      eventType: 'UNKNOWN_ERROR',
      eventCampaignId: null,
      eventRunId: 'run-1',
      activeCampaignId: null,
      activeRunId: null,
      stoppedRunId: 'run-1',
    }),
    true,
  )

  assert.equal(
    shouldHandleCampaignAbortEvent({
      eventType: 'UNKNOWN_ERROR',
      eventCampaignId: null,
      eventRunId: 'run-2',
      activeCampaignId: null,
      activeRunId: 'run-1',
      stoppedRunId: 'run-1',
    }),
    false,
  )

  assert.equal(
    shouldHandleCampaignAbortEvent({
      eventType: 'UNKNOWN_ERROR',
      eventCampaignId: null,
      eventRunId: null,
      activeCampaignId: null,
      activeRunId: 'run-1',
      stoppedRunId: 'run-1',
    }),
    false,
  )

  assert.equal(
    shouldHandleCampaignAbortEvent({
      eventType: 'STEP_ERROR',
      eventCampaignId: null,
      eventRunId: 'run-1',
      activeCampaignId: null,
      activeRunId: 'run-1',
      stoppedRunId: null,
    }),
    false,
  )
})

test('shouldHandleCampaignAbortEvent falls back to campaign id before run ids are tracked', () => {
  assert.equal(
    shouldHandleCampaignAbortEvent({
      eventType: 'UNKNOWN_ERROR',
      eventCampaignId: 'campaign-1',
      eventRunId: null,
      activeCampaignId: 'campaign-1',
      activeRunId: null,
      stoppedRunId: null,
    }),
    true,
  )

  assert.equal(
    shouldHandleCampaignAbortEvent({
      eventType: 'UNKNOWN_ERROR',
      eventCampaignId: 'campaign-2',
      eventRunId: null,
      activeCampaignId: 'campaign-1',
      activeRunId: null,
      stoppedRunId: null,
    }),
    false,
  )

  assert.equal(
    shouldHandleCampaignAbortEvent({
      eventType: 'STEP_ERROR',
      eventCampaignId: 'campaign-1',
      eventRunId: null,
      activeCampaignId: 'campaign-1',
      activeRunId: null,
      stoppedRunId: null,
    }),
    false,
  )
})

test('getExecutingCapabilityNodeIdsToAbort only selects executing capability nodes', () => {
  assert.deepEqual(
    getExecutingCapabilityNodeIdsToAbort({
      nodes: [
        { id: 'cap-executing', type: 'capability' },
        { id: 'cap-complete', type: 'capability' },
        { id: 'cap-idle', type: 'capability' },
        { id: 'cap-error', type: 'capability' },
        { id: 'visualization-executing', type: 'visualization' },
        { id: 'code-executing', type: 'code' },
      ],
      nodeStatuses: {
        'cap-executing': 'executing',
        'cap-complete': 'complete',
        'cap-error': 'error',
        'visualization-executing': 'executing',
        'code-executing': 'executing',
      },
    }),
    ['cap-executing'],
  )
})

test('resolveCampaignRelayNodeId uses direct node ids before fallback order', () => {
  const stepToNodeMap: Record<string, string> = {}

  const resolved = resolveCampaignRelayNodeId({
    taskId: 'node-1',
    currentNodeIds: ['node-1'],
    stepToNodeMap,
    executionNodeOrder: ['fallback-node'],
    nextExecutionNodeIndex: 0,
  })

  assert.deepEqual(resolved, {
    nodeId: 'node-1',
    nextExecutionNodeIndex: 0,
  })
  assert.deepEqual(stepToNodeMap, { 'node-1': 'node-1' })
})

test('resolveCampaignRelayNodeId ignores visualization node ids outside orchestrator control', () => {
  const stepToNodeMap: Record<string, string> = {}

  const resolved = resolveCampaignRelayNodeId({
    taskId: 'visualization-node',
    currentNodeIds: ['capability-node'],
    ignoredNodeIds: ['visualization-node'],
    stepToNodeMap,
    executionNodeOrder: ['capability-node'],
    nextExecutionNodeIndex: 0,
  })

  assert.deepEqual(resolved, {
    nodeId: null,
    nextExecutionNodeIndex: 0,
  })
  assert.deepEqual(stepToNodeMap, {})
})

test('resolveCampaignRelayNodeId maps unknown task ids by capability order', () => {
  const stepToNodeMap: Record<string, string> = {}

  const first = resolveCampaignRelayNodeId({
    taskId: 'step-a',
    currentNodeIds: ['node-1', 'node-2'],
    stepToNodeMap,
    executionNodeOrder: ['node-1', 'node-2'],
    nextExecutionNodeIndex: 0,
  })
  const replayed = resolveCampaignRelayNodeId({
    taskId: 'step-a',
    currentNodeIds: ['node-1', 'node-2'],
    stepToNodeMap,
    executionNodeOrder: ['node-1', 'node-2'],
    nextExecutionNodeIndex: first.nextExecutionNodeIndex,
  })
  const second = resolveCampaignRelayNodeId({
    taskId: 'step-b',
    currentNodeIds: ['node-1', 'node-2'],
    stepToNodeMap,
    executionNodeOrder: ['node-1', 'node-2'],
    nextExecutionNodeIndex: first.nextExecutionNodeIndex,
  })

  assert.deepEqual(first, {
    nodeId: 'node-1',
    nextExecutionNodeIndex: 1,
  })
  assert.deepEqual(replayed, {
    nodeId: 'node-1',
    nextExecutionNodeIndex: 1,
  })
  assert.deepEqual(second, {
    nodeId: 'node-2',
    nextExecutionNodeIndex: 2,
  })
  assert.deepEqual(stepToNodeMap, {
    'step-a': 'node-1',
    'step-b': 'node-2',
  })
})
