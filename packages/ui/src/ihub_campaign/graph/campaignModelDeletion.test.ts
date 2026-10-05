/* eslint-disable @typescript-eslint/no-require-imports -- Node's direct TS test runner loads pure model helpers. */
const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')
const {
  deleteCampaignModelTask,
  deleteCampaignModelTaskGroup,
}: typeof import('./campaignModelDeletion') = require('./campaignModelDeletion.ts')
type CampaignModel = import('@ihub/utils/types/campaign').CampaignModel
type CampaignTask = import('@ihub/utils/types/campaign').CampaignTask

function makeOutputTask(
  id: string,
  outputPaths: string[],
  taskDependencies: string[] = [],
): CampaignTask {
  return {
    id,
    hierarchy: 'capability',
    capability: `Capability ${id}`,
    operation_id: `operation-${id}`,
    task_dependencies: taskDependencies,
    output: {
      schema: {},
      values: outputPaths.map((path, index) => ({
        id: `${id}-output-${index}`,
        var: path,
      })),
    },
  }
}

function makeCampaignModel(): CampaignModel {
  return {
    id: 'campaign-1',
    run_id: '',
    name: 'Campaign',
    user: 'user',
    description: '',
    task_groups: [
      {
        id: 'group-1',
        group_dependencies: [],
        tasks: [
          makeOutputTask('task-1', []),
          makeOutputTask('task-2', [], ['task-1']),
        ],
        objectives: [],
        ui_edges: [
          { source: 'task-1', target: 'task-2' },
          { source: 'task-2', target: 'task-3' },
        ],
      },
      {
        id: 'group-2',
        group_dependencies: ['group-1'],
        tasks: [
          makeOutputTask('task-3', []),
          makeOutputTask('task-4', [], ['task-1', 'task-2', 'task-3']),
        ],
        objectives: [],
        ui_edges: [
          { source: 'task-1', target: 'task-3' },
          { source: 'task-3', target: 'task-1' },
          { source: 'task-2', target: 'task-4' },
          { source: 'task-3', target: 'task-4' },
        ],
      },
    ],
    objectives: {
      max_runtime: [
        { id: 'runtime-1', max_time: '00:05:00', task_group: 'group-1' },
        { id: 'runtime-2', max_time: '00:10:00', task_group: 'group-2' },
      ],
      threshold: [
        {
          id: 'threshold-1',
          var: 'value',
          type: 'upper_limit',
          target: 1,
          task_group: 'group-1',
        },
        {
          id: 'threshold-2',
          var: 'value',
          type: 'range',
          target: 2,
          task_group: 'group-2',
        },
      ],
    },
    inputs: [],
    outputs: [],
  }
}

test('deleting a task cleans dependencies and incident UI edges', () => {
  const result = deleteCampaignModelTask(
    makeCampaignModel(),
    'group-1',
    'task-1',
  )
  const owningGroup = result.task_groups[0]!
  const otherGroup = result.task_groups[1]!

  assert.deepEqual(
    owningGroup.tasks.map((task) => task.id),
    ['task-2'],
  )
  assert.deepEqual(owningGroup.tasks[0]?.task_dependencies, [])
  assert.deepEqual(owningGroup.ui_edges, [
    { source: 'task-2', target: 'task-3' },
  ])
  assert.deepEqual(
    otherGroup.tasks.map((task) => task.id),
    ['task-3', 'task-4'],
  )
  assert.deepEqual(otherGroup.tasks[1]?.task_dependencies, ['task-2', 'task-3'])
  assert.deepEqual(otherGroup.ui_edges, [
    { source: 'task-2', target: 'task-4' },
    { source: 'task-3', target: 'task-4' },
  ])
})

test('task cleanup preserves an absent UI edges property', () => {
  const campaign = makeCampaignModel()
  campaign.task_groups.push({
    id: 'group-3',
    group_dependencies: [],
    tasks: [],
    objectives: [],
  })

  const result = deleteCampaignModelTask(campaign, 'group-1', 'task-1')

  assert.equal('ui_edges' in result.task_groups[2]!, false)
})

test('deleting the final task leaves an empty task group', () => {
  const campaign = makeCampaignModel()
  campaign.task_groups[0]!.tasks = [campaign.task_groups[0]!.tasks[0]!]
  campaign.task_groups[0]!.ui_edges = [{ source: 'task-1', target: 'task-1' }]

  const result = deleteCampaignModelTask(campaign, 'group-1', 'task-1')

  assert.deepEqual(result.task_groups[0]?.tasks, [])
  assert.deepEqual(result.task_groups[0]?.ui_edges, [])
})

test('deleting a sole variable producer removes orphaned objectives', () => {
  const campaign = makeCampaignModel()
  campaign.task_groups[0]!.tasks = [
    makeOutputTask('task-1', ['sole.boolean', 'sole.number']),
    makeOutputTask('task-2', ['surviving.value'], ['task-1']),
  ]
  campaign.task_groups[0]!.objectives = [
    {
      id: 'assert-orphaned',
      type: 'assert',
      var: 'sole.boolean',
      target: true,
    },
    {
      id: 'assert-unknown',
      type: 'assert',
      var: 'unknown.value',
      target: true,
    },
    { id: 'iterate-1', type: 'iterate', iterations: 3 },
  ]
  campaign.objectives = {
    max_runtime: campaign.objectives!.max_runtime,
    threshold: [
      {
        id: 'threshold-orphaned',
        var: 'sole.number',
        type: 'upper_limit',
        target: 10,
        task_group: 'group-1',
      },
      {
        id: 'threshold-unknown',
        var: 'unknown.value',
        type: 'upper_limit',
        target: 20,
        task_group: 'group-1',
      },
      {
        id: 'threshold-other-group',
        var: 'sole.number',
        type: 'upper_limit',
        target: 30,
        task_group: 'group-2',
      },
    ],
  }

  const result = deleteCampaignModelTask(campaign, 'group-1', 'task-1')

  assert.deepEqual(
    result.task_groups[0]?.objectives.map((objective) => objective.id),
    ['assert-unknown', 'iterate-1'],
  )
  assert.deepEqual(
    result.objectives?.max_runtime.map((objective) => objective.id),
    ['runtime-1', 'runtime-2'],
  )
  assert.deepEqual(
    result.objectives?.threshold.map((objective) => objective.id),
    ['threshold-unknown', 'threshold-other-group'],
  )
})

test('deleting a duplicate variable producer preserves objectives', () => {
  const campaign = makeCampaignModel()
  campaign.task_groups[0]!.tasks = [
    makeOutputTask('task-1', ['shared.value']),
    makeOutputTask('task-2', ['shared.value']),
  ]
  campaign.task_groups[0]!.objectives = [
    { id: 'assert-shared', type: 'assert', var: 'shared.value', target: true },
  ]
  campaign.objectives!.threshold = [
    {
      id: 'threshold-shared',
      var: 'shared.value',
      type: 'upper_limit',
      target: 10,
      task_group: 'group-1',
    },
  ]

  const result = deleteCampaignModelTask(campaign, 'group-1', 'task-1')

  assert.deepEqual(result.task_groups[0]?.objectives, [
    { id: 'assert-shared', type: 'assert', var: 'shared.value', target: true },
  ])
  assert.deepEqual(result.objectives?.threshold, [
    {
      id: 'threshold-shared',
      var: 'shared.value',
      type: 'upper_limit',
      target: 10,
      task_group: 'group-1',
    },
  ])
})

test('deleting a task group cleans dependencies and campaign objectives', () => {
  const result = deleteCampaignModelTaskGroup(makeCampaignModel(), 'group-1')
  const survivingGroup = result.task_groups[0]!

  assert.deepEqual(
    result.task_groups.map((group) => group.id),
    ['group-2'],
  )
  assert.deepEqual(survivingGroup.group_dependencies, [])
  assert.deepEqual(
    survivingGroup.tasks.map((task) => task.id),
    ['task-3', 'task-4'],
  )
  assert.deepEqual(survivingGroup.tasks[1]?.task_dependencies, ['task-3'])
  assert.deepEqual(survivingGroup.ui_edges, [
    { source: 'task-3', target: 'task-4' },
  ])
  assert.deepEqual(
    result.objectives?.max_runtime.map((objective) => objective.id),
    ['runtime-2'],
  )
  assert.deepEqual(
    result.objectives?.threshold.map((objective) => objective.id),
    ['threshold-2'],
  )
})

test('deleting the final task group preserves an empty campaign', () => {
  const campaign = makeCampaignModel()
  campaign.task_groups = [campaign.task_groups[0]!]
  campaign.objectives = {
    max_runtime: [campaign.objectives!.max_runtime[0]!],
    threshold: [campaign.objectives!.threshold[0]!],
  }

  const result = deleteCampaignModelTaskGroup(campaign, 'group-1')

  assert.deepEqual(result.task_groups, [])
  assert.deepEqual(result.objectives, { max_runtime: [], threshold: [] })
})

test('missing task and group IDs return the original model', () => {
  const campaign = makeCampaignModel()

  assert.equal(
    deleteCampaignModelTask(campaign, 'group-1', 'missing'),
    campaign,
  )
  assert.equal(deleteCampaignModelTask(campaign, 'missing', 'task-1'), campaign)
  assert.equal(deleteCampaignModelTaskGroup(campaign, 'missing'), campaign)
})

test('task-group deletion preserves null campaign objectives', () => {
  const campaign = makeCampaignModel()
  campaign.objectives = null

  assert.equal(
    deleteCampaignModelTaskGroup(campaign, 'group-1').objectives,
    null,
  )
})

test('task deletion preserves null campaign objectives', () => {
  const campaign = makeCampaignModel()
  campaign.objectives = null

  assert.equal(
    deleteCampaignModelTask(campaign, 'group-1', 'task-1').objectives,
    null,
  )
})
