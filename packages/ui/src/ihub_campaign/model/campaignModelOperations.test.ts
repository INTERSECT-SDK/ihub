/* eslint-disable @typescript-eslint/no-require-imports -- Node's direct TypeScript runner loads sibling modules with require(). */
const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')

import type {
  Capability,
  CampaignModel,
  CampaignTask,
} from '@ihub/utils/types/campaign'
import type { NodeStatus } from '../state/executionContext'

const {
  addCampaignTask,
  addCampaignTaskGroup,
  createCampaignTaskGroup,
  createCapabilityTask,
  createEventTask,
  createJsonFileTask,
  createJsonTextTask,
  createRendererTask,
  createVisualizationTask,
}: typeof import('./taskOperations') = require('./taskOperations.ts')
const {
  addTaskGroupObjective,
  changeUnifiedObjectiveKind,
  removeUnifiedObjective,
  updateAssertObjective,
  updateIterateObjective,
  updateThresholdObjective,
}: typeof import('./objectiveOperations') = require('./objectiveOperations.ts')
const {
  aggregateTaskGroupStatus,
  getExecutableCampaignTasks,
  getCampaignModelTabs,
  getTaskGroupIteration,
  hasExecutableCampaignTasks,
  isExecutableCampaignTask,
}: typeof import('./selectors') = require('./selectors.ts')

function task(id: string, overrides: Partial<CampaignTask> = {}): CampaignTask {
  return {
    id,
    hierarchy: 'capability',
    capability: 'Capability',
    operation_id: 'run',
    event_name: null,
    task_dependencies: [],
    task_objectives: null,
    ...overrides,
  }
}

function campaign(): CampaignModel {
  return {
    id: 'campaign-1',
    run_id: 'run-1',
    name: 'Campaign',
    user: 'owner',
    description: '',
    task_groups: [
      {
        id: 'group-1',
        group_dependencies: [],
        tasks: [task('task-1')],
        objectives: [],
      },
    ],
    objectives: null,
    inputs: [],
    outputs: [],
  }
}

test('task and task-group additions are immutable and missing groups are no-ops', () => {
  const source = campaign()
  const group = createCampaignTaskGroup('group-2')
  const withGroup = addCampaignTaskGroup(source, group)
  assert.deepEqual(
    withGroup.task_groups.map(({ id }) => id),
    ['group-1', 'group-2'],
  )
  assert.equal(source.task_groups.length, 1)

  const added = addCampaignTask(
    withGroup,
    'group-2',
    createJsonTextTask('json-1'),
  )
  assert.equal(added.task_groups[1]?.tasks[0]?.id, 'json-1')
  assert.equal(addCampaignTask(source, 'missing', task('new')), source)
})

test('task constructors retain the available creation contracts', () => {
  const capability = {
    id: 'capability-1',
    name: 'Example',
    endpoints_schema: { endpoints: { run: { publish: {}, subscribe: {} } } },
  } as unknown as Capability
  const constructors = [
    createCapabilityTask(capability, 'run', 'capability-task'),
    createEventTask(capability, 'ready', 'event-task'),
    createVisualizationTask('plotly-line', 'Plot', 'visualization-task'),
    createRendererTask('text-renderer', 'Text', 'renderer-task'),
    createJsonFileTask('json-file-task'),
    createJsonTextTask('json-text-task'),
  ]
  assert.deepEqual(
    constructors.map(({ id }) => id),
    [
      'capability-task',
      'event-task',
      'visualization-task',
      'renderer-task',
      'json-file-task',
      'json-text-task',
    ],
  )
  assert.equal(constructors[0]?.endpoint_channel?.publish != null, true)
  assert.equal(constructors[1]?.event_mode, 'once')
})

test('objective operations add, update, convert, remove, and preserve no-op identity', () => {
  const source = campaign()
  const added = addTaskGroupObjective(
    source,
    'group-1',
    'assert',
    'objective-1',
  )
  const updated = updateAssertObjective(added, 'group-1', 'objective-1', {
    var: 'temperature',
    target: false,
  })
  const iterated = changeUnifiedObjectiveKind(
    updated,
    'group-1',
    'objective-1',
    'task_group',
    'iterate',
  )
  const clamped = updateIterateObjective(iterated, 'group-1', 'objective-1', {
    iterations: 0,
  })
  assert.equal(clamped.task_groups[0]?.objectives[0]?.type, 'iterate')
  assert.equal(
    'iterations' in clamped.task_groups[0]!.objectives[0]!
      ? clamped.task_groups[0]!.objectives[0].iterations
      : null,
    1,
  )

  const threshold = changeUnifiedObjectiveKind(
    updated,
    'group-1',
    'objective-1',
    'task_group',
    'range',
  )
  assert.equal(threshold.objectives?.threshold[0]?.var, 'temperature')
  const bounded = updateThresholdObjective(threshold, 'objective-1', {
    target: 99,
  })
  assert.equal(bounded.objectives?.threshold[0]?.target, 3.13)
  const removed = removeUnifiedObjective(
    bounded,
    'group-1',
    'objective-1',
    'threshold',
  )
  assert.deepEqual(removed.objectives?.threshold, [])
  assert.equal(
    removeUnifiedObjective(source, 'group-1', 'missing', 'task_group'),
    source,
  )
  assert.equal(updateThresholdObjective(source, 'missing', {}), source)
})

test('tabs and task-group status follow canonical order and executable state', () => {
  const source = campaign()
  assert.deepEqual(getCampaignModelTabs(source), [
    { id: 'master-campaign', label: 'Campaign' },
    { id: 'group-1', label: 'Task Group 1' },
  ])
  const statuses: Record<string, NodeStatus> = { 'task-1': 'complete' }
  assert.equal(
    aggregateTaskGroupStatus(source.task_groups[0]!, statuses),
    'complete',
  )
  statuses['task-1'] = 'executing'
  assert.equal(
    aggregateTaskGroupStatus(source.task_groups[0]!, statuses),
    'executing',
  )
})

test('task-group iteration follows the furthest executable task', () => {
  const taskGroup = {
    ...campaign().task_groups[0]!,
    tasks: [
      task('first'),
      task('editor-only', { hierarchy: 'code' }),
      task('last'),
    ],
  }

  assert.equal(
    getTaskGroupIteration(taskGroup, {
      first: 3,
      'editor-only': 99,
      last: 2,
    }),
    3,
  )
  assert.equal(getTaskGroupIteration(taskGroup, {}), 0)
})

test('executable task classification matches the backend compiler boundary', () => {
  const cases: Array<{
    name: string
    candidate: CampaignTask
    executable: boolean
  }> = [
    {
      name: 'ordinary capability task',
      candidate: task('capability'),
      executable: true,
    },
    {
      name: 'Event task',
      candidate: task('event', {
        operation_id: null,
        event_name: 'ready',
      }),
      executable: true,
    },
    {
      name: 'unknown hierarchy',
      candidate: task('unknown', { hierarchy: 'future-task' }),
      executable: true,
    },
    {
      name: 'Code hierarchy from a saved campaign',
      candidate: task('code', {
        hierarchy: 'Code',
        capability: 'Notebook',
      }),
      executable: false,
    },
    {
      name: 'visualization hierarchy',
      candidate: task('visualization', { hierarchy: 'visualization' }),
      executable: false,
    },
    {
      name: 'renderer hierarchy',
      candidate: task('renderer', { hierarchy: 'renderer' }),
      executable: false,
    },
    {
      name: 'JSON File hierarchy',
      candidate: task('json-file', { hierarchy: 'JSON-FILE' }),
      executable: false,
    },
    {
      name: 'JSON Text hierarchy',
      candidate: task('json-text', { hierarchy: 'json-text' }),
      executable: false,
    },
    {
      name: 'Code capability fallback',
      candidate: task('code-capability', { capability: 'Code' }),
      executable: false,
    },
    {
      name: 'Visualization capability fallback',
      candidate: task('visualization-capability', {
        capability: 'vIsUaLiZaTiOn',
      }),
      executable: false,
    },
    {
      name: 'Renderer capability fallback',
      candidate: task('renderer-capability', { capability: 'Renderer' }),
      executable: false,
    },
  ]

  for (const { name, candidate, executable } of cases) {
    assert.equal(isExecutableCampaignTask(candidate), executable, name)
  }
})

test('executable task selection preserves canonical task order', () => {
  const taskGroup = {
    ...campaign().task_groups[0]!,
    tasks: [
      task('json', { hierarchy: 'json-file' }),
      task('first'),
      task('renderer', { capability: 'Renderer' }),
      task('event', { operation_id: null, event_name: 'ready' }),
      task('last', { hierarchy: 'future-task' }),
    ],
  }

  assert.deepEqual(
    getExecutableCampaignTasks(taskGroup).map(({ id }) => id),
    ['first', 'event', 'last'],
  )
})

test('editor-only statuses do not affect task-group aggregation', () => {
  const mixedTaskGroup = {
    ...campaign().task_groups[0]!,
    tasks: [
      task('code', { hierarchy: 'code' }),
      task('capability'),
      task('visualization', { capability: 'Visualization' }),
    ],
  }
  const executableStatuses: NodeStatus[] = [
    'waiting',
    'executing',
    'complete',
    'error',
    'aborted',
  ]

  for (const status of executableStatuses) {
    assert.equal(
      aggregateTaskGroupStatus(mixedTaskGroup, {
        code: status === 'executing' ? 'complete' : 'executing',
        capability: status,
        visualization: status === 'error' ? 'complete' : 'error',
      }),
      status,
    )
  }

  const editorOnlyTaskGroup = {
    ...mixedTaskGroup,
    tasks: mixedTaskGroup.tasks.filter(({ id }) => id !== 'capability'),
  }
  for (const status of executableStatuses) {
    assert.equal(
      aggregateTaskGroupStatus(editorOnlyTaskGroup, {
        code: status,
        visualization: status,
      }),
      'idle',
    )
  }
})

test('campaign execution eligibility requires an executable task', () => {
  const withTasks = (...tasks: CampaignTask[]): CampaignModel => ({
    ...campaign(),
    task_groups: [{ ...campaign().task_groups[0]!, tasks }],
  })

  assert.equal(
    hasExecutableCampaignTasks({ ...campaign(), task_groups: [] }),
    false,
  )
  assert.equal(hasExecutableCampaignTasks(withTasks()), false)
  assert.equal(
    hasExecutableCampaignTasks(
      withTasks(
        task('code', { hierarchy: 'code' }),
        task('json', { hierarchy: 'json-text' }),
      ),
    ),
    false,
  )
  assert.equal(
    hasExecutableCampaignTasks(
      withTasks(task('event', { operation_id: null, event_name: 'ready' })),
    ),
    true,
  )
  assert.equal(
    hasExecutableCampaignTasks(
      withTasks(
        task('renderer', { hierarchy: 'renderer' }),
        task('capability'),
      ),
    ),
    true,
  )
})
