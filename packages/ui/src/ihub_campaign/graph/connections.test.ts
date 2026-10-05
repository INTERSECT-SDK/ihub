/* eslint-disable @typescript-eslint/no-require-imports -- Node loads the sibling TS helper directly. */
const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')

const {
  buildCampaignEdge,
  getCampaignConnectionWarning,
  getLogicalCampaignTaskEdgeEndpoints,
  isExecutableCampaignTaskConnection,
  isValidCampaignConnection,
  orientCampaignConnectionFromDragStart,
} = require('./connections.ts') as typeof import('./connections')

type CampaignEdge = import('@ihub/utils/types/campaign').CampaignEdge
type CampaignTask = import('@ihub/utils/types/campaign').CampaignTask
type FlowNode = import('@xyflow/react').Node

function campaignTask(
  id: string,
  overrides: Partial<CampaignTask> = {},
): CampaignTask {
  return {
    id,
    hierarchy: 'org.example.capability',
    capability: 'Example Capability',
    operation_id: 'run',
    event_name: null,
    event_count: null,
    task_dependencies: [],
    ...overrides,
  }
}

const graphNodes: FlowNode[] = [
  {
    id: 'source-node',
    type: 'capability',
    data: {},
    position: { x: 0, y: 0 },
  },
  {
    id: 'target-node',
    type: 'capability',
    data: {},
    position: { x: 200, y: 100 },
  },
]

const dependencyClassificationNodes: FlowNode[] = [
  ...graphNodes,
  {
    id: 'event-source',
    type: 'event',
    data: {},
    position: { x: 0, y: 200 },
  },
  {
    id: 'event-target',
    type: 'event',
    data: {},
    position: { x: 200, y: 200 },
  },
  {
    id: 'code-source',
    type: 'code',
    data: {},
    position: { x: 0, y: 400 },
  },
  {
    id: 'json-source',
    type: 'json-file',
    data: {},
    position: { x: 0, y: 600 },
  },
  {
    id: 'visualization-target',
    type: 'visualization',
    data: {},
    position: { x: 200, y: 400 },
  },
  {
    id: 'renderer-target',
    type: 'text-renderer',
    data: {},
    position: { x: 200, y: 600 },
  },
]

const jsonConnectionNodes: FlowNode[] = [
  {
    id: 'json-node',
    type: 'json-file',
    data: {},
    position: { x: 0, y: 0 },
  },
  {
    id: 'visualization-node',
    type: 'visualization',
    data: {},
    position: { x: 200, y: 0 },
  },
  {
    id: 'capability-node',
    type: 'capability',
    data: {},
    position: { x: 400, y: 0 },
  },
  {
    id: 'code-node',
    type: 'code',
    data: {},
    position: { x: 600, y: 0 },
  },
  {
    id: 'other-json-node',
    type: 'json-file',
    data: {},
    position: { x: 800, y: 0 },
  },
]

const jsonConnectionWarning =
  'JSON File and JSON Text nodes can only connect from their output to a Capability input.'

test('campaign task edges normalize only reverse-horizontal endpoints', () => {
  assert.deepEqual(
    getLogicalCampaignTaskEdgeEndpoints({
      source: 'source-node',
      target: 'target-node',
      sourceHandle: 'output-right',
      targetHandle: 'input-left',
    }),
    { source: 'source-node', target: 'target-node' },
  )
  assert.deepEqual(
    getLogicalCampaignTaskEdgeEndpoints({
      source: 'target-node',
      target: 'source-node',
      sourceHandle: 'input-left',
      targetHandle: 'output-right',
    }),
    { source: 'source-node', target: 'target-node' },
  )
  assert.deepEqual(
    getLogicalCampaignTaskEdgeEndpoints({
      source: 'source-node',
      target: 'target-node',
      sourceHandle: 'bottom',
      targetHandle: 'top',
    }),
    { source: 'source-node', target: 'target-node' },
  )
})

test('campaign graph orients loose connections from the drag start node', () => {
  const reactFlowConnection = {
    source: 'target-node',
    target: 'source-node',
    sourceHandle: 'output-right',
    targetHandle: 'input-left',
  }

  assert.deepEqual(
    orientCampaignConnectionFromDragStart(reactFlowConnection, 'source-node'),
    {
      source: 'source-node',
      target: 'target-node',
      sourceHandle: 'input-left',
      targetHandle: 'output-right',
    },
  )
  assert.equal(
    orientCampaignConnectionFromDragStart(reactFlowConnection, 'target-node'),
    reactFlowConnection,
  )
})

test('campaign graph validates supported connection handle pairs', () => {
  const validHandlePairs = [
    ['bottom', 'top'],
    ['top', 'bottom'],
    ['bottom', 'bottom'],
    ['top', 'top'],
    ['output-right', 'input-left'],
    ['input-left', 'output-right'],
  ]

  for (const [sourceHandle, targetHandle] of validHandlePairs) {
    assert.equal(
      isValidCampaignConnection(
        {
          source: 'source-node',
          target: 'target-node',
          sourceHandle,
          targetHandle,
        },
        graphNodes,
      ),
      true,
      `${sourceHandle} -> ${targetHandle} should be valid`,
    )
  }
})

test('campaign graph rejects missing nodes and unsupported handles', () => {
  assert.equal(
    isValidCampaignConnection(
      {
        source: 'source-node',
        target: 'missing-node',
        sourceHandle: 'bottom',
        targetHandle: 'top',
      },
      graphNodes,
    ),
    false,
  )
  assert.equal(
    isValidCampaignConnection(
      {
        source: 'source-node',
        target: 'target-node',
        sourceHandle: 'bottom',
        targetHandle: 'input-left',
      },
      graphNodes,
    ),
    false,
  )
})

test('campaign graph allows only canonical JSON file to capability mappings', () => {
  const jsonToVisualization = {
    source: 'json-node',
    target: 'visualization-node',
    sourceHandle: 'output-right',
    targetHandle: 'input-left',
  }
  const visualizationToJson = {
    source: 'visualization-node',
    target: 'json-node',
    sourceHandle: 'output-right',
    targetHandle: 'input-left',
  }
  const jsonToCapability = {
    source: 'json-node',
    target: 'capability-node',
    sourceHandle: 'output-right',
    targetHandle: 'input-left',
  }
  const jsonToCode = {
    source: 'json-node',
    target: 'code-node',
    sourceHandle: 'output-right',
    targetHandle: 'input-left',
  }
  const jsonToJson = {
    source: 'json-node',
    target: 'other-json-node',
    sourceHandle: 'output-right',
    targetHandle: 'input-left',
  }
  assert.equal(
    isValidCampaignConnection(jsonToVisualization, jsonConnectionNodes),
    false,
  )
  assert.equal(
    isValidCampaignConnection(visualizationToJson, jsonConnectionNodes),
    false,
  )
  assert.equal(
    isValidCampaignConnection(jsonToCapability, jsonConnectionNodes),
    true,
  )
  assert.equal(
    isValidCampaignConnection(jsonToCode, jsonConnectionNodes),
    false,
  )
  assert.equal(
    isValidCampaignConnection(jsonToJson, jsonConnectionNodes),
    false,
  )
  assert.equal(
    getCampaignConnectionWarning(jsonToVisualization, jsonConnectionNodes),
    jsonConnectionWarning,
  )
  assert.equal(
    getCampaignConnectionWarning(visualizationToJson, jsonConnectionNodes),
    jsonConnectionWarning,
  )
  assert.equal(
    getCampaignConnectionWarning(jsonToCapability, jsonConnectionNodes),
    null,
  )
  assert.equal(
    getCampaignConnectionWarning(jsonToCode, jsonConnectionNodes),
    jsonConnectionWarning,
  )
  assert.equal(
    getCampaignConnectionWarning(jsonToJson, jsonConnectionNodes),
    jsonConnectionWarning,
  )
})

test('campaign graph rejects a normalized edge when the drag targets a JSON file', () => {
  const normalizedJsonToCapability = {
    source: 'json-node',
    target: 'capability-node',
    sourceHandle: 'output-right',
    targetHandle: 'input-left',
  }
  const reverseDrag = { dragStartNodeId: 'capability-node' }

  assert.equal(
    isValidCampaignConnection(
      normalizedJsonToCapability,
      jsonConnectionNodes,
      reverseDrag,
    ),
    false,
  )
  assert.equal(
    buildCampaignEdge(
      normalizedJsonToCapability,
      jsonConnectionNodes,
      reverseDrag,
    ),
    null,
  )
  assert.equal(
    getCampaignConnectionWarning(
      normalizedJsonToCapability,
      jsonConnectionNodes,
      reverseDrag,
    ),
    jsonConnectionWarning,
  )
  assert.equal(
    isValidCampaignConnection(normalizedJsonToCapability, jsonConnectionNodes, {
      dragStartNodeId: 'json-node',
    }),
    true,
  )
})

test('campaign graph classifies unsupported JSON reconnection attempts only', () => {
  const unsupportedReconnection = {
    source: 'visualization-node',
    target: 'json-node',
    sourceHandle: 'input-left',
    targetHandle: 'output-right',
  }

  assert.equal(
    isValidCampaignConnection(unsupportedReconnection, jsonConnectionNodes),
    false,
  )
  assert.equal(
    getCampaignConnectionWarning(unsupportedReconnection, jsonConnectionNodes),
    jsonConnectionWarning,
  )
  assert.equal(
    getCampaignConnectionWarning(
      {
        source: 'json-node',
        target: 'capability-node',
        sourceHandle: 'bottom',
        targetHandle: 'top',
      },
      jsonConnectionNodes,
    ),
    null,
  )
  assert.equal(
    getCampaignConnectionWarning(
      {
        source: 'json-node',
        target: null,
        sourceHandle: 'output-right',
        targetHandle: null,
      },
      jsonConnectionNodes,
    ),
    null,
  )
})

test('campaign graph preserves reverse horizontal connections between non-JSON nodes', () => {
  const reverseCapabilityConnection = {
    source: 'source-node',
    target: 'target-node',
    sourceHandle: 'input-left',
    targetHandle: 'output-right',
  }

  assert.equal(
    isValidCampaignConnection(reverseCapabilityConnection, graphNodes),
    true,
  )
  assert.equal(
    getCampaignConnectionWarning(reverseCapabilityConnection, graphNodes),
    null,
  )
})

test('campaign graph builds vertical, feedback, and orthogonal metadata', () => {
  const vertical = buildCampaignEdge(
    {
      source: 'source-node',
      target: 'target-node',
      sourceHandle: 'top',
      targetHandle: 'bottom',
    },
    graphNodes,
  )
  const feedback = buildCampaignEdge(
    {
      source: 'source-node',
      target: 'target-node',
      sourceHandle: 'bottom',
      targetHandle: 'top',
    },
    graphNodes,
  )
  const orthogonal = buildCampaignEdge(
    {
      source: 'source-node',
      target: 'target-node',
      sourceHandle: 'bottom',
      targetHandle: 'bottom',
    },
    graphNodes,
  )

  assert.equal(vertical?.id, 'edge-source-node-top-target-node-bottom')
  assert.equal(vertical?.reconnectable, true)
  assert.deepEqual(vertical?.data?.data_mapping, [])
  assert.deepEqual(vertical?.markerEnd, {
    type: 'arrowclosed',
    width: 12,
    height: 12,
    color: '#4b5563',
  })
  assert.equal(feedback?.data?.isFeedback, true)
  assert.equal(orthogonal?.data?.isOrthogonal, true)
})

test('campaign graph classifies every capability and event edge as a dependency', () => {
  const executablePairs = [
    ['source-node', 'target-node'],
    ['source-node', 'event-target'],
    ['event-source', 'target-node'],
    ['event-source', 'event-target'],
  ]

  for (const [source, target] of executablePairs) {
    for (const dataMapping of [
      [],
      [
        {
          source_parameter: 'output',
          target_parameter: 'input',
        },
      ],
    ]) {
      const dependency = buildCampaignEdge(
        {
          source,
          target,
          sourceHandle: 'output-right',
          targetHandle: 'input-left',
        },
        dependencyClassificationNodes,
        {
          oldEdge: {
            id: `edge-${source}-${target}`,
            source: source!,
            target: target!,
            data: { data_mapping: dataMapping },
          },
        },
      )

      assert.equal(
        dependency?.data?.isDependencyEdge,
        true,
        `${source} -> ${target} should be a dependency`,
      )
      assert.deepEqual(dependency?.data?.data_mapping, dataMapping)
    }
  }
})

test('campaign graph keeps editor-only connections out of dependencies', () => {
  const editorPairs = [
    ['code-source', 'source-node', 'bottom', 'top'],
    ['json-source', 'source-node', 'output-right', 'input-left'],
    ['source-node', 'visualization-target', 'bottom', 'top'],
    ['source-node', 'renderer-target', 'bottom', 'top'],
  ]

  for (const [source, target, sourceHandle, targetHandle] of editorPairs) {
    const edge = buildCampaignEdge(
      { source, target, sourceHandle, targetHandle },
      dependencyClassificationNodes,
    )
    assert.equal(
      edge?.data?.isDependencyEdge,
      false,
      `${source} -> ${target} should remain editor-only`,
    )
  }

  const selfEdge = buildCampaignEdge(
    {
      source: 'source-node',
      target: 'source-node',
      sourceHandle: 'bottom',
      targetHandle: 'top',
    },
    dependencyClassificationNodes,
  )
  assert.equal(selfEdge?.data?.isDependencyEdge, false)
})

test('canonical task connections reject every editor-only task classification', () => {
  const executableTask = campaignTask('executable')
  const editorOnlyTasks = [
    campaignTask('code-hierarchy', { hierarchy: 'CoDe' }),
    campaignTask('visualization-hierarchy', { hierarchy: 'VISUALIZATION' }),
    campaignTask('renderer-hierarchy', { hierarchy: 'Renderer' }),
    campaignTask('json-file-hierarchy', { hierarchy: 'JSON-File' }),
    campaignTask('json-text-hierarchy', { hierarchy: 'json-TEXT' }),
    campaignTask('code-capability', { capability: 'Code' }),
    campaignTask('visualization-capability', {
      capability: 'Visualization',
    }),
    campaignTask('renderer-capability', { capability: 'Renderer' }),
  ]
  const tasks = [executableTask, ...editorOnlyTasks]

  for (const editorOnlyTask of editorOnlyTasks) {
    for (const connection of [
      { source: editorOnlyTask.id, target: executableTask.id },
      { source: executableTask.id, target: editorOnlyTask.id },
    ]) {
      assert.equal(
        isExecutableCampaignTaskConnection(connection, tasks),
        false,
        `${connection.source} -> ${connection.target} should be editor-only`,
      )
    }
  }
})

test('canonical task connections reject missing endpoints and self-connections', () => {
  const tasks = [campaignTask('source'), campaignTask('target')]

  for (const connection of [
    { source: 'missing', target: 'target' },
    { source: 'source', target: 'missing' },
    { source: 'source', target: 'source' },
    { source: null, target: 'target' },
    { source: 'source', target: null },
  ]) {
    assert.equal(isExecutableCampaignTaskConnection(connection, tasks), false)
  }
})

test('canonical task connections accept capability and event pairings', () => {
  const tasks = [
    campaignTask('capability-source'),
    campaignTask('capability-target'),
    campaignTask('event-source', {
      operation_id: null,
      event_name: 'started',
    }),
    campaignTask('event-target', {
      operation_id: null,
      event_name: 'completed',
    }),
  ]

  for (const [source, target] of [
    ['capability-source', 'capability-target'],
    ['capability-source', 'event-target'],
    ['event-source', 'capability-target'],
    ['event-source', 'event-target'],
  ]) {
    assert.equal(
      isExecutableCampaignTaskConnection({ source, target }, tasks),
      true,
      `${source} -> ${target} should be executable`,
    )
  }
})

test('campaign graph derives horizontal direction from drag intent', () => {
  const forward = buildCampaignEdge(
    {
      source: 'source-node',
      target: 'target-node',
      sourceHandle: 'output-right',
      targetHandle: 'input-left',
    },
    graphNodes,
    { dragStartNodeId: 'source-node' },
  )
  const reverse = buildCampaignEdge(
    {
      source: 'source-node',
      target: 'target-node',
      sourceHandle: 'input-left',
      targetHandle: 'output-right',
    },
    graphNodes,
    { dragStartNodeId: 'target-node' },
  )

  assert.equal(forward?.data?.horizontalDirection, 'right')
  assert.equal(reverse?.data?.horizontalDirection, 'left')
  assert.equal(forward?.markerStart, undefined)
  assert.equal(forward?.markerEnd, undefined)
})

test('campaign graph reconnect preserves mapping and recalculates route metadata', () => {
  const oldEdge: CampaignEdge = {
    id: 'existing-edge-id',
    source: 'source-node',
    target: 'target-node',
    sourceHandle: 'top',
    targetHandle: 'bottom',
    type: 'baseCampaignEdge',
    data: {
      data_mapping: [
        {
          source_parameter: 'temperature',
          target_parameter: 'input_temperature',
        },
      ],
      isFeedback: false,
      isOrthogonal: false,
    },
  }
  const edge = buildCampaignEdge(
    {
      source: 'target-node',
      target: 'source-node',
      sourceHandle: 'bottom',
      targetHandle: 'bottom',
    },
    graphNodes,
    { oldEdge },
  )

  assert.equal(edge?.id, oldEdge.id)
  assert.equal(edge?.source, 'target-node')
  assert.deepEqual(edge?.data?.data_mapping, oldEdge.data?.data_mapping)
  assert.equal(edge?.data?.isOrthogonal, true)
})

test('campaign graph reconnect recalculates dependency classification', () => {
  const oldEdge: CampaignEdge = {
    id: 'reconnected-edge',
    source: 'source-node',
    target: 'target-node',
    data: {
      data_mapping: [{ source_parameter: 'output', target_parameter: 'input' }],
      isDependencyEdge: true,
      extension: 'preserved',
    },
  }
  const editorEdge = buildCampaignEdge(
    {
      source: 'source-node',
      target: 'visualization-target',
      sourceHandle: 'bottom',
      targetHandle: 'top',
    },
    dependencyClassificationNodes,
    { oldEdge },
  )
  const executableEdge = buildCampaignEdge(
    {
      source: 'event-source',
      target: 'target-node',
      sourceHandle: 'bottom',
      targetHandle: 'top',
    },
    dependencyClassificationNodes,
    { oldEdge: editorEdge! },
  )

  assert.equal(editorEdge?.data?.isDependencyEdge, false)
  assert.equal(executableEdge?.data?.isDependencyEdge, true)
  assert.deepEqual(
    executableEdge?.data?.data_mapping,
    oldEdge.data?.data_mapping,
  )
  assert.equal(executableEdge?.data?.extension, 'preserved')
})
