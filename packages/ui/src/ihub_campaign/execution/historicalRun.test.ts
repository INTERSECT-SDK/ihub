/* eslint-disable @typescript-eslint/no-require-imports -- Node runs these TypeScript tests directly. */
const assert: typeof import('node:assert/strict') = require('node:assert/strict')
const { test }: typeof import('node:test') = require('node:test')

import type { CampaignModel } from '@ihub/utils/types/campaign'

const { extractHistoricalRunErrors, reconstructHistoricalNodeStatuses } =
  require('./historicalRun.ts') as typeof import('./historicalRun')
import type { CampaignRecoverySnapshot } from './recovery'

const model = {
  id: 'campaign-1',
  run_id: '',
  name: 'Campaign',
  description: '',
  user: '',
  objectives: null,
  inputs: [],
  outputs: [],
  task_groups: [
    {
      id: 'group-1',
      group_dependencies: [],
      objectives: [],
      tasks: [
        {
          id: 'node-1',
          capability: 'Detector',
          hierarchy: 'capability',
          operation_id: 'detect',
          event_name: null,
          event_count: null,
          task_dependencies: [],
        },
      ],
    },
  ],
} satisfies CampaignModel

function recovery(): CampaignRecoverySnapshot {
  return {
    run: {
      id: 1,
      user_email: 'user@example.com',
      campaign_id: 'campaign-1',
      run_id: 'run-1',
      run_at: '2026-09-23T12:00:00Z',
      orchestrator_url: null,
      status: 'ABORTED',
      outcome: 'FAILED',
      ended_at: '2026-09-23T12:01:00Z',
      campaign_name: 'Campaign',
      broker_id: 1,
    },
    events: [
      {
        id: 1,
        campaign_id: 'campaign-1',
        run_id: 'run-1',
        step_id: 'orchestrator-step',
        created_at: '2026-09-23T12:00:00Z',
        event_type: 'STEP_START',
        fields_to_populate: null,
        exception_message: null,
        payload: null,
      },
      {
        id: 2,
        campaign_id: 'campaign-1',
        run_id: 'run-1',
        step_id: 'orchestrator-step',
        created_at: '2026-09-23T12:00:02Z',
        event_type: 'STEP_FAIL',
        fields_to_populate: null,
        exception_message: "b'Detector failed'",
        payload: { stack_trace: 'secret' },
      },
      {
        id: 3,
        campaign_id: 'campaign-1',
        run_id: 'run-1',
        step_id: null,
        created_at: '2026-09-23T12:00:03Z',
        event_type: 'CAMPAIGN_ERROR_SCHEMA',
        fields_to_populate: null,
        exception_message: null,
        payload: { private: 'not exposed' },
      },
    ],
  }
}

test('reconstructs terminal node statuses and resolves sanitized errors', () => {
  const snapshot = recovery()
  const reconstructed = reconstructHistoricalNodeStatuses(model, snapshot)
  const errors = extractHistoricalRunErrors(
    model,
    snapshot,
    reconstructed.stepToNodeMap,
  )

  assert.equal(reconstructed.nodeStatuses['node-1'], 'error')
  assert.equal(reconstructed.nodeRunCounts['node-1'], 1)
  assert.deepEqual(
    errors.map(({ eventId, message, scope, nodeId }) => ({
      eventId,
      message,
      scope,
      nodeId,
    })),
    [
      {
        eventId: 2,
        message: 'Detector failed',
        scope: 'task',
        nodeId: 'node-1',
      },
      {
        eventId: 3,
        message: 'The campaign did not match the required schema.',
        scope: 'campaign',
        nodeId: null,
      },
    ],
  )
  assert.equal('payload' in errors[0]!, false)
  assert.equal('stack_trace' in errors[0]!, false)
})

test('supports missing payloads and friendly fallback messages', () => {
  const snapshot = recovery()
  snapshot.events = [
    {
      ...snapshot.events[1]!,
      id: 4,
      event_type: 'UNKNOWN_ERROR',
      exception_message: null,
      payload: null,
    },
  ]

  const errors = extractHistoricalRunErrors(model, snapshot, {})

  assert.equal(errors[0]?.scope, 'campaign')
  assert.equal(
    errors[0]?.message,
    'The campaign stopped because of an unknown error.',
  )
})

test('attributes flat task identifiers to direct and mapped campaign nodes', () => {
  const snapshot = recovery()
  snapshot.events = [
    {
      ...snapshot.events[1]!,
      id: 4,
      step_id: null,
      event_type: null,
      payload: {
        event: { event_type: 'STEP_FAIL' },
        task_id: 'node-1',
      },
    },
    {
      ...snapshot.events[1]!,
      id: 5,
      step_id: null,
      event_type: null,
      payload: {
        event_type: 'STEP_ERROR',
        node_id: 'orchestrator-step',
      },
    },
  ]

  const errors = extractHistoricalRunErrors(model, snapshot, {
    'orchestrator-step': 'node-1',
  })

  assert.deepEqual(
    errors.map(({ eventId, stepId, nodeId, scope }) => ({
      eventId,
      stepId,
      nodeId,
      scope,
    })),
    [
      {
        eventId: 4,
        stepId: 'node-1',
        nodeId: 'node-1',
        scope: 'task',
      },
      {
        eventId: 5,
        stepId: 'orchestrator-step',
        nodeId: 'node-1',
        scope: 'task',
      },
    ],
  )
})

test('prefers payload task and node identifiers over persisted step ids', () => {
  const snapshot = recovery()
  snapshot.events = [
    {
      ...snapshot.events[1]!,
      id: 6,
      step_id: 'wrong-persisted-step',
      event_type: null,
      payload: {
        event: { event_type: 'STEP_FAIL', task_id: 'node-1' },
      },
    },
    {
      ...snapshot.events[1]!,
      id: 7,
      step_id: 'wrong-persisted-step',
      event_type: null,
      payload: {
        event: { event_type: 'STEP_ERROR', task_id: ' ' },
        node_id: 'node-1',
      },
    },
  ]

  const errors = extractHistoricalRunErrors(model, snapshot, {})

  assert.deepEqual(
    errors.map(({ eventId, stepId, nodeId, scope }) => ({
      eventId,
      stepId,
      nodeId,
      scope,
    })),
    [
      { eventId: 6, stepId: 'node-1', nodeId: 'node-1', scope: 'task' },
      { eventId: 7, stepId: 'node-1', nodeId: 'node-1', scope: 'task' },
    ],
  )
})

test('replays opaque steps in executed order but labels the submitted model', () => {
  const nodeA: CampaignModel['task_groups'][number]['tasks'][number] = {
    id: 'node-a',
    capability: 'Detector',
    hierarchy: 'capability',
    operation_id: 'detect',
    event_name: null,
    event_count: null,
    task_dependencies: [],
  }
  const nodeB: CampaignModel['task_groups'][number]['tasks'][number] = {
    id: 'node-b',
    capability: 'Analyzer',
    hierarchy: 'capability',
    operation_id: 'analyze',
    event_name: null,
    event_count: null,
    task_dependencies: ['node-a'],
  }
  const submittedModel: CampaignModel = {
    ...model,
    task_groups: [
      {
        id: 'group-1',
        group_dependencies: [],
        objectives: [],
        tasks: [nodeB, nodeA],
      },
    ],
  }
  const executedModel: CampaignModel = {
    ...submittedModel,
    task_groups: [
      {
        id: 'group-1',
        group_dependencies: [],
        objectives: [],
        tasks: [nodeA, nodeB],
      },
    ],
  }
  const snapshot = recovery()
  snapshot.events = [
    {
      ...snapshot.events[0]!,
      step_id: 'opaque-a',
    },
    {
      ...snapshot.events[1]!,
      step_id: 'opaque-a',
      event_type: 'CAMPAIGN_ERROR_FROM_SERVICE',
      exception_message: 'Detector failed',
    },
  ]

  const reconstructed = reconstructHistoricalNodeStatuses(
    executedModel,
    snapshot,
  )
  const errors = extractHistoricalRunErrors(
    submittedModel,
    snapshot,
    reconstructed.stepToNodeMap,
  )

  assert.equal(reconstructed.nodeStatuses['node-a'], 'error')
  assert.equal(reconstructed.nodeStatuses['node-b'], 'aborted')
  assert.deepEqual(reconstructed.stepToNodeMap, { 'opaque-a': 'node-a' })
  assert.equal(errors[0]?.nodeId, 'node-a')
  assert.equal(errors[0]?.taskLabel, 'detect')
  assert.deepEqual(submittedModel.task_groups[0]!.tasks, [nodeB, nodeA])
})

test('ignores events persisted after a canceled run ended', () => {
  const snapshot = recovery()
  snapshot.run.outcome = 'CANCELED'
  snapshot.run.ended_at = '2026-09-23T12:00:01Z'
  snapshot.events = [
    {
      ...snapshot.events[0]!,
      step_id: 'opaque-step',
      created_at: '2026-09-23T12:00:00Z',
    },
    {
      ...snapshot.events[1]!,
      step_id: 'opaque-step',
      created_at: '2026-09-23T12:00:02Z',
      event_type: 'CAMPAIGN_ERROR_FROM_SERVICE',
      exception_message: 'Late failure',
    },
  ]

  const reconstructed = reconstructHistoricalNodeStatuses(model, snapshot)
  const errors = extractHistoricalRunErrors(
    model,
    snapshot,
    reconstructed.stepToNodeMap,
  )

  assert.equal(reconstructed.nodeStatuses['node-1'], 'aborted')
  assert.deepEqual(errors, [])
})

test('includes terminal events recorded exactly when the run ended', () => {
  const snapshot = recovery()
  snapshot.run.ended_at = '2026-09-23T12:00:02Z'
  snapshot.events = [
    {
      ...snapshot.events[0]!,
      step_id: 'opaque-step',
      created_at: '2026-09-23T12:00:00Z',
    },
    {
      ...snapshot.events[1]!,
      step_id: 'opaque-step',
      created_at: snapshot.run.ended_at,
      event_type: 'CAMPAIGN_ERROR_SCHEMA',
      exception_message: 'Boundary failure',
    },
  ]

  const reconstructed = reconstructHistoricalNodeStatuses(model, snapshot)
  const errors = extractHistoricalRunErrors(
    model,
    snapshot,
    reconstructed.stepToNodeMap,
  )

  assert.equal(reconstructed.nodeStatuses['node-1'], 'error')
  assert.equal(errors[0]?.message, 'Boundary failure')
  assert.equal(errors[0]?.nodeId, 'node-1')
})

test('excludes errors persisted after the winning successful terminal event', () => {
  const snapshot = recovery()
  snapshot.events = [
    {
      ...snapshot.events[1]!,
      id: 12,
      created_at: '2026-09-23T12:00:02Z',
      event_type: 'UNKNOWN_ERROR',
    },
    {
      ...snapshot.events[1]!,
      id: 11,
      created_at: '2026-09-23T12:00:01Z',
      event_type: 'CAMPAIGN_COMPLETE',
      step_id: null,
      exception_message: null,
    },
    {
      ...snapshot.events[1]!,
      id: 10,
      created_at: '2026-09-23T12:00:00Z',
      event_type: 'STEP_FAIL',
    },
  ]

  const errors = extractHistoricalRunErrors(model, snapshot, {
    'orchestrator-step': 'node-1',
  })

  assert.deepEqual(
    errors.map(({ eventId }) => eventId),
    [10],
  )
})

test('includes the winning failure and excludes events persisted after it', () => {
  const snapshot = recovery()
  snapshot.events = [
    {
      ...snapshot.events[1]!,
      id: 22,
      created_at: '2026-09-23T12:00:01Z',
      event_type: 'STEP_FAIL',
    },
    {
      ...snapshot.events[1]!,
      id: 23,
      created_at: '2026-09-23T12:00:02Z',
      event_type: 'CAMPAIGN_ERROR_SCHEMA',
      step_id: null,
      exception_message: null,
    },
    {
      ...snapshot.events[1]!,
      id: 21,
      created_at: '2026-09-23T12:00:01Z',
      event_type: 'UNKNOWN_ERROR',
      step_id: null,
      exception_message: 'Winning failure',
    },
  ]

  const errors = extractHistoricalRunErrors(model, snapshot, {})

  assert.deepEqual(
    errors.map(({ eventId, message }) => ({ eventId, message })),
    [{ eventId: 21, message: 'Winning failure' }],
  )
})
