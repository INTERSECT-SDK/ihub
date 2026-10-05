/* eslint-disable @typescript-eslint/no-require-imports -- Node's focused runner loads sibling TypeScript modules directly. */
const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')

import type { Node } from '@xyflow/react'
import type {
  CampaignEdge,
  CampaignGraphData,
  CampaignModel,
} from '@ihub/utils/types/campaign'

const {
  preserveCampaignModelCapabilityInputs,
  preserveCampaignGraphSelection,
  reconcileCampaignGraph,
}: typeof import('./campaignGraphSynchronization') = require('./campaignGraphSynchronization.ts')

function createCampaignModel(): CampaignModel {
  return {
    id: 'campaign-1',
    run_id: 'run-1',
    name: 'Campaign',
    user: 'user',
    description: 'description',
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
            id: 'task-1',
            capability: 'Capability',
            operation_id: 'run',
            event_name: null,
            hierarchy: 'capability',
            task_dependencies: [],
            manual_input_values: { value: 'new' },
          },
          {
            id: 'task-2',
            capability: 'Capability',
            operation_id: 'run',
            event_name: null,
            hierarchy: 'capability',
            task_dependencies: [],
            manual_input_values: { value: 'second' },
          },
        ],
      },
    ],
  }
}

function capabilityNode(id: string, value: string, x = 0): Node {
  return {
    id,
    type: 'capability',
    position: { x, y: 0 },
    data: { manualInputValues: { value } },
  }
}

function storeSnapshot(
  nodes: Node[],
  edges: CampaignEdge[] = [],
  editorRevision = 1,
) {
  const state: CampaignGraphData = {
    campaignId: 'campaign-1',
    campaignName: 'Campaign',
    nodes: nodes as CampaignGraphData['nodes'],
    edges,
    createdAt: '',
    updatedAt: '',
  }
  return {
    state,
    origin: 'editor' as const,
    revision: editorRevision,
    modelRevision: 0,
    editorRevision,
  }
}

test('graph serialization preserves newer model-backed capability inputs', () => {
  const model = createCampaignModel()
  const staleNodes = [
    capabilityNode('task-1', 'old', 40),
    capabilityNode('task-2', 'second'),
  ]
  const reconciled = preserveCampaignModelCapabilityInputs(
    model,
    'group-1',
    staleNodes,
  )

  assert.deepEqual(reconciled[0]!.data.manualInputValues, { value: 'new' })
  assert.deepEqual(reconciled[0]!.position, { x: 40, y: 0 })
})

test('deleting a node preserves other edited inputs without restoring it', () => {
  const result = reconcileCampaignGraph({
    campaignModel: createCampaignModel(),
    selectedSheetId: 'group-1',
    storeSnapshot: storeSnapshot([capabilityNode('task-2', 'stale')]),
    handledEditorRevision: 0,
  })

  assert.equal(result.source, 'editor')
  assert.deepEqual(
    result.campaignModel.task_groups[0]!.tasks.map(({ id }) => id),
    ['task-2'],
  )
  assert.deepEqual(
    result.campaignModel.task_groups[0]!.tasks[0]!.manual_input_values,
    { value: 'second' },
  )
})

test('pending editor graph mutation and model input update are both retained', () => {
  const model = createCampaignModel()
  const edge = {
    id: 'edge-1',
    source: 'task-1',
    target: 'task-2',
    data: { isDependencyEdge: true },
  } as CampaignEdge
  const result = reconcileCampaignGraph({
    campaignModel: model,
    selectedSheetId: 'group-1',
    storeSnapshot: storeSnapshot(
      [capabilityNode('task-1', 'old', 90), capabilityNode('task-2', 'second')],
      [edge],
      2,
    ),
    handledEditorRevision: 1,
  })

  const tasks = result.campaignModel.task_groups[0]!.tasks
  assert.deepEqual(tasks[0]!.manual_input_values, { value: 'new' })
  assert.deepEqual(tasks[0]!.ui_position, { x: 90, y: 0 })
  assert.deepEqual(tasks[1]!.task_dependencies, ['task-1'])
  assert.deepEqual(result.campaignModel.task_groups[0]!.ui_edges, [edge])
  assert.equal(result.handledEditorRevision, 2)
})

test('a consumed editor revision is not selected for persistence twice', () => {
  const result = reconcileCampaignGraph({
    campaignModel: createCampaignModel(),
    selectedSheetId: 'group-1',
    storeSnapshot: storeSnapshot([capabilityNode('task-1', 'old')], [], 3),
    handledEditorRevision: 3,
  })

  assert.equal(result.source, 'model')
  assert.equal(result.handledEditorRevision, 3)
  assert.equal(result.nodes.length, 2)
})

test('model hydration replaces store graph when no editor revision is pending', () => {
  const result = reconcileCampaignGraph({
    campaignModel: createCampaignModel(),
    selectedSheetId: 'group-1',
    storeSnapshot: storeSnapshot(
      [capabilityNode('deleted-task', 'stale')],
      [],
      0,
    ),
    handledEditorRevision: 0,
  })

  assert.equal(result.source, 'model')
  assert.deepEqual(
    result.nodes.map(({ id }) => id),
    ['task-1', 'task-2'],
  )
  assert.deepEqual(result.nodes[0]!.data.manualInputValues, { value: 'new' })
})

test('same-scope projection preserves selection and refreshed node data', () => {
  const currentNodes = [
    { ...capabilityNode('task-1', 'old'), selected: true },
    capabilityNode('task-2', 'second'),
  ]
  const projectedNodes = [
    capabilityNode('task-1', 'new'),
    capabilityNode('task-2', 'second'),
  ]
  const scope = {
    viewIdentity: 'campaign:campaign-1',
    selectedSheetId: 'group-1',
  }

  const result = preserveCampaignGraphSelection(
    currentNodes,
    projectedNodes,
    scope,
    scope,
  )

  assert.equal(result[0]!.selected, true)
  assert.deepEqual(result[0]!.data.manualInputValues, { value: 'new' })
  assert.equal(result[1]!.selected, undefined)
})

test('same-scope projection preserves every selected node without restoring removed nodes', () => {
  const currentNodes = [
    { ...capabilityNode('task-1', 'old'), selected: true },
    { ...capabilityNode('task-2', 'second'), selected: true },
    { ...capabilityNode('removed-task', 'removed'), selected: true },
    capabilityNode('unselected-task', 'unselected'),
  ]
  const projectedNodes = [
    capabilityNode('task-1', 'new'),
    capabilityNode('task-2', 'second'),
    capabilityNode('unselected-task', 'unselected'),
  ]
  const scope = {
    viewIdentity: 'campaign:campaign-1',
    selectedSheetId: 'group-1',
  }

  const result = preserveCampaignGraphSelection(
    currentNodes,
    projectedNodes,
    scope,
    scope,
  )

  assert.deepEqual(
    result.filter(({ selected }) => selected).map(({ id }) => id),
    ['task-1', 'task-2'],
  )
  assert.equal(
    result.some(({ id }) => id === 'removed-task'),
    false,
  )
  assert.equal(result[2]!.selected, undefined)
})

test('graph scope changes do not inherit selection', () => {
  const currentNodes = [{ ...capabilityNode('task-1', 'old'), selected: true }]
  const projectedNodes = [capabilityNode('task-1', 'new')]
  const previousScope = {
    viewIdentity: 'campaign:campaign-1',
    selectedSheetId: 'group-1',
  }

  const changedSheetResult = preserveCampaignGraphSelection(
    currentNodes,
    projectedNodes,
    previousScope,
    { ...previousScope, selectedSheetId: 'group-2' },
  )
  const changedViewResult = preserveCampaignGraphSelection(
    currentNodes,
    projectedNodes,
    previousScope,
    { ...previousScope, viewIdentity: 'run:run-1' },
  )

  assert.equal(changedSheetResult[0]!.selected, undefined)
  assert.equal(changedViewResult[0]!.selected, undefined)
})
