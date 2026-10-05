/* eslint-disable @typescript-eslint/no-require-imports -- Node reads repository fixtures and sibling TypeScript directly. */
const { readFileSync }: typeof import('node:fs') = require('node:fs')
const { join }: typeof import('node:path') = require('node:path')
const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')

const {
  buildCampaignModelContextGraph,
  projectCampaignModelGraph,
  serializeCampaignModelGraph,
}: typeof import('./campaignModelProjection') = require('./campaignModelProjection.ts')
const { applyCapabilityInputDrafts } =
  require('../model/capabilityInputDrafts.ts') as typeof import('../model/capabilityInputDrafts')
const {
  PlotlyVisualizationRegistryByType,
}: typeof import('../../ihub_visualization/plotly_components/plotlyRegistry') = require('../../ihub_visualization/plotly_components/plotlyRegistry.ts')

type CampaignModel = import('@ihub/utils/types/campaign').CampaignModel
type PlotlyVisualizationNode =
  import('@ihub/utils/types/campaign').PlotlyVisualizationNode

const fixturePath = join(
  __dirname,
  '../../../../..',
  'contracts',
  'campaign',
  'fixtures',
  'editor',
  'canonical-campaign.editor.json',
)

function loadModel(): CampaignModel {
  return JSON.parse(readFileSync(fixturePath, 'utf8')) as CampaignModel
}

function projectVisualization(model: CampaignModel): PlotlyVisualizationNode {
  const group = model.task_groups[1]!
  const node = projectCampaignModelGraph(model, group.id).nodes.find(
    ({ id }) => id === 'canonical-visualization',
  )!
  return node.data as PlotlyVisualizationNode
}

test('projects canonical editor tasks with stable identity and metadata', () => {
  const model = loadModel()
  const original = structuredClone(model)
  const group = model.task_groups[1]!
  const graph = projectCampaignModelGraph(model, group.id)

  assert.deepEqual(
    graph.nodes.map((node) => node.type),
    [
      'visualization',
      'image-renderer',
      'text-renderer',
      'json-file',
      'json-text',
    ],
  )
  assert.deepEqual(
    graph.nodes.map((node) => node.id),
    group.tasks.map((task) => task.id),
  )
  assert.deepEqual(
    graph.nodes.map(({ width }) => width),
    [420, 420, 420, 400, 400],
  )
  assert.deepEqual(
    graph.nodes.map(({ style }) => style?.width),
    ['420px', '420px', '420px', '400px', '400px'],
  )
  assert.deepEqual(
    graph.nodes.map(({ initialHeight }) => initialHeight),
    [120, 120, 120, 120, 120],
  )
  assert.ok(graph.nodes.every(({ height }) => height === undefined))
  assert.deepEqual(model, original)
})

test('projects capability and Event cards at their original width', () => {
  const model = loadModel()
  const group = model.task_groups[0]!
  const graph = projectCampaignModelGraph(model, group.id)

  assert.deepEqual(
    graph.nodes.map(({ width }) => width),
    [400, 400, 400, 400],
  )
  assert.deepEqual(
    graph.nodes.map(({ style }) => style?.width),
    ['400px', '400px', '400px', '400px'],
  )
  assert.ok(
    graph.nodes.every(
      ({ height, initialHeight }) =>
        height === undefined && initialHeight === 120,
    ),
  )
})

test('manual input updates preserve capability metadata and schema references', () => {
  const model = loadModel()
  const group = model.task_groups[0]!
  const task = group.tasks.find(({ id }) => id === 'canonical-capability')!
  task.capability_metadata!.endpoints_schema.endpoints.process =
    task.endpoint_channel!
  const firstNode = projectCampaignModelGraph(model, group.id).nodes.find(
    ({ id }) => id === task.id,
  )!
  const firstData = firstNode.data as {
    capability: NonNullable<typeof task.capability_metadata>
    endpoint_channel: NonNullable<typeof task.endpoint_channel>
    manualInputValues?: Record<string, unknown>
  }

  const updated = applyCapabilityInputDrafts(
    model,
    [
      {
        provenanceKey: `campaign:${model.id}`,
        taskGroupId: group.id,
        taskId: task.id,
        inputPath: 'label',
        displayValue: 'updated value',
      },
    ],
    { expectedProvenanceKey: `campaign:${model.id}` },
  )
  const secondNode = projectCampaignModelGraph(updated, group.id).nodes.find(
    ({ id }) => id === task.id,
  )!
  const secondData = secondNode.data as typeof firstData

  assert.equal(secondData.manualInputValues?.label, 'updated value')
  assert.strictEqual(firstData.capability, task.capability_metadata)
  assert.strictEqual(secondData.capability, firstData.capability)
  assert.strictEqual(
    secondData.capability.endpoints_schema,
    firstData.capability.endpoints_schema,
  )
  assert.strictEqual(
    secondData.endpoint_channel?.subscribe?.message.payload,
    firstData.endpoint_channel?.subscribe?.message.payload,
  )
})

test('initializes a new histogram from registered defaults and stored metadata', () => {
  const model = loadModel()
  const task = model.task_groups[1]!.tasks[0]!
  task.operation_id = 'plotly-histogram'
  task.manual_input_values = {
    __visualization_name: 'Distribution',
    __visualization_config: {
      input_mappings: {
        x: {
          sourceNodeId: 'canonical-json-file',
          sourcePath: '/readings',
        },
      },
    },
  }

  const visualization = projectVisualization(model)

  assert.equal(visualization.name, 'Distribution')
  assert.equal(visualization.type, 'plotly-histogram')
  assert.deepEqual(
    visualization.plotlyData,
    PlotlyVisualizationRegistryByType['plotly-histogram']!.plotlyData,
  )
  assert.deepEqual(
    visualization.plotlyLayout,
    PlotlyVisualizationRegistryByType['plotly-histogram']!.plotlyLayout,
  )
  assert.deepEqual(
    visualization.config,
    task.manual_input_values.__visualization_config,
  )
  assert.notStrictEqual(
    visualization.config,
    task.manual_input_values.__visualization_config,
  )
})

test('returns fresh nested registry defaults for every projection', () => {
  const model = loadModel()
  model.task_groups[1]!.tasks[0]!.operation_id = 'plotly-histogram'
  const registryEntry = PlotlyVisualizationRegistryByType['plotly-histogram']!
  const originalRegistryEntry = structuredClone(registryEntry)

  const first = projectVisualization(model)
  const firstTrace = first.plotlyData[0] as {
    marker: { color: string }
  }
  firstTrace.marker.color = 'orange'
  ;(first.plotlyLayout.margin as Partial<Plotly.Margin>).t = 999

  assert.deepEqual(registryEntry, originalRegistryEntry)
  assert.deepEqual(projectVisualization(model), {
    name: 'Canonical line chart',
    type: 'plotly-histogram',
    plotlyData: registryEntry.plotlyData,
    plotlyLayout: registryEntry.plotlyLayout,
    config:
      model.task_groups[1]!.tasks[0]!.manual_input_values!
        .__visualization_config,
  })
})

test('keeps persisted visualization data authoritative and isolated', () => {
  const model = loadModel()
  const task = model.task_groups[1]!.tasks[0]!
  task.operation_id = 'plotly-histogram'
  task.visualization_data = {
    name: 'Persisted custom chart',
    type: 'custom-plotly-type',
    plotlyData: [
      {
        type: 'bar',
        marker: { color: 'teal' },
        x: ['persisted'],
        y: [42],
      },
    ],
    plotlyLayout: {
      title: { text: 'Persisted layout' },
      margin: { t: 7 },
    },
    config: {
      input_mappings: {
        y: {
          sourceNodeId: 'custom-source',
          sourcePath: '/value',
        },
      },
    },
  }
  const persisted = structuredClone(task.visualization_data)

  const visualization = projectVisualization(model)
  assert.deepEqual(visualization, persisted)
  ;(
    visualization.plotlyData[0] as {
      marker: { color: string }
    }
  ).marker.color = 'orange'
  ;(visualization.plotlyLayout.margin as Partial<Plotly.Margin>).t = 999
  visualization.config.input_mappings!.y!.sourcePath = '/changed'

  assert.deepEqual(task.visualization_data, persisted)
  assert.deepEqual(projectVisualization(model), persisted)
})

test('projects unknown visualization types with stored metadata and empty data', () => {
  const model = loadModel()
  const task = model.task_groups[1]!.tasks[0]!
  task.operation_id = 'plotly-retired'
  task.manual_input_values = {
    __visualization_name: 'Retired chart',
    __visualization_config: {
      input_mappings: {
        value: {
          sourceNodeId: 'canonical-json-text',
          sourcePath: '/legacy',
        },
      },
    },
  }

  assert.deepEqual(projectVisualization(model), {
    name: 'Retired chart',
    type: 'plotly-retired',
    plotlyData: [],
    plotlyLayout: {},
    config: task.manual_input_values.__visualization_config,
  })
})

test('preserves explicit UI edges and serializes graph edits', () => {
  const model = loadModel()
  const group = model.task_groups[1]!
  const graph = projectCampaignModelGraph(model, group.id)
  const renderer = graph.nodes.find((node) => node.type === 'text-renderer')!
  renderer.position = { x: 701, y: 702 }
  ;(renderer.data as Record<string, unknown>).name = 'Edited renderer'

  const serialized = serializeCampaignModelGraph(
    model,
    group.id,
    graph.nodes,
    graph.edges,
  )
  const task = serialized.task_groups[1]!.tasks.find(
    ({ id }) => id === 'canonical-text-renderer',
  )!
  assert.equal(task.renderer_data?.name, 'Edited renderer')
  assert.deepEqual(task.ui_position, { x: 701, y: 702 })
  assert.deepEqual(
    serialized.task_groups[1]!.ui_edges!.map(({ id }) => id),
    group.ui_edges!.map(({ id }) => id),
  )
})

test('derives dependency edges when ui_edges is absent', () => {
  const model = loadModel()
  const group = model.task_groups[0]!
  delete group.ui_edges
  assert.deepEqual(
    projectCampaignModelGraph(model, group.id).edges.map((edge) => [
      edge.source,
      edge.target,
    ]),
    [
      ['canonical-event-once', 'canonical-event-count'],
      ['canonical-event-count', 'canonical-event-persistent'],
      ['canonical-event-once', 'canonical-capability'],
      ['canonical-event-count', 'canonical-capability'],
      ['canonical-event-persistent', 'canonical-capability'],
    ],
  )
})

test('synthesizes each missing executable dependency edge once', () => {
  const model = loadModel()
  const group = model.task_groups[0]!
  delete group.ui_edges
  group.tasks[3]!.task_dependencies.push('canonical-event-once')
  const matchingEdges = projectCampaignModelGraph(model, group.id).edges.filter(
    ({ source, target }) =>
      source === 'canonical-event-once' && target === 'canonical-capability',
  )

  assert.equal(matchingEdges.length, 1)
})

test('keeps master-sheet task-group dependencies explicitly classified', () => {
  const model = loadModel()
  const graph = projectCampaignModelGraph(model, 'master-campaign')

  assert.ok(
    graph.nodes.every(
      ({ height, initialHeight }) =>
        height === 120 && initialHeight === undefined,
    ),
  )

  assert.deepEqual(
    graph.edges.map(({ source, target, data }) => ({
      source,
      target,
      isDependencyEdge: data?.isDependencyEdge,
    })),
    [
      {
        source: 'canonical-acquisition-group',
        target: 'canonical-presentation-group',
        isDependencyEdge: true,
      },
    ],
  )
})

test('projects declared executable dependencies without losing stored edge metadata', () => {
  const model = loadModel()
  const group = model.task_groups[0]!
  const graph = projectCampaignModelGraph(model, group.id)
  const mappedEdge = graph.edges.find(
    ({ id }) => id === 'canonical-edge-count-capability',
  )!

  assert.equal(mappedEdge.data?.isDependencyEdge, true)
  assert.equal(
    mappedEdge.data?.unknown_edge_data_property,
    'preserve-canonical-edge-data-extension',
  )
  assert.equal(
    (mappedEdge as Record<string, unknown>).unknown_edge_property,
    'preserve-canonical-edge-extension',
  )
  assert.deepEqual(mappedEdge.data?.data_mapping, [
    { source_parameter: 'sample', target_parameter: 'sample' },
  ])
  assert.deepEqual(
    graph.edges.map(({ source, target }) => [source, target]),
    [
      ['canonical-event-once', 'canonical-event-count'],
      ['canonical-event-count', 'canonical-capability'],
      ['canonical-event-count', 'canonical-event-persistent'],
      ['canonical-event-once', 'canonical-capability'],
      ['canonical-event-persistent', 'canonical-capability'],
    ],
  )
})

test('round-trips reverse-horizontal dependencies without rewriting the UI edge', () => {
  const model = loadModel()
  const group = model.task_groups[0]!
  const logicalParentId = 'canonical-event-count'
  const logicalChildId = 'canonical-capability'
  const reverseEdge = {
    id: 'reverse-horizontal-dependency',
    source: logicalChildId,
    target: logicalParentId,
    sourceHandle: 'input-left',
    targetHandle: 'output-right',
    type: 'baseCampaignEdge',
    reconnectable: true,
    data: {
      data_mapping: [
        { source_parameter: 'sample', target_parameter: 'sample' },
      ],
      horizontalDirection: 'left' as const,
      unknown_edge_data_property: 'preserve-reverse-edge-data-extension',
    },
    unknown_edge_property: 'preserve-reverse-edge-extension',
  }
  group.ui_edges = [reverseEdge]
  group.tasks.forEach((task) => {
    task.task_dependencies = task.id === logicalChildId ? [logicalParentId] : []
  })

  const graph = projectCampaignModelGraph(model, group.id)
  const matchingEdges = graph.edges.filter(({ id }) => id === reverseEdge.id)

  assert.equal(matchingEdges.length, 1)
  assert.equal(graph.edges.length, 1)
  assert.equal(matchingEdges[0]!.data?.isDependencyEdge, true)
  assert.equal(matchingEdges[0]!.source, logicalChildId)
  assert.equal(matchingEdges[0]!.target, logicalParentId)

  const serialized = serializeCampaignModelGraph(
    model,
    group.id,
    graph.nodes,
    graph.edges,
  )
  const serializedGroup = serialized.task_groups[0]!
  const tasks = new Map(serializedGroup.tasks.map((task) => [task.id, task]))

  assert.deepEqual(tasks.get(logicalChildId)!.task_dependencies, [
    logicalParentId,
  ])
  assert.deepEqual(tasks.get(logicalParentId)!.task_dependencies, [])
  assert.deepEqual(serializedGroup.ui_edges, [
    { ...reverseEdge, data: matchingEdges[0]!.data },
  ])

  const reloaded = projectCampaignModelGraph(serialized, group.id)
  assert.equal(reloaded.edges.length, 1)
  assert.equal(reloaded.edges[0]!.id, reverseEdge.id)
  assert.equal(reloaded.edges[0]!.data?.isDependencyEdge, true)
})

test('does not project invalid or editor-only task dependencies', () => {
  const model = loadModel()
  const acquisitionGroup = model.task_groups[0]!
  acquisitionGroup.tasks[0]!.task_dependencies = [
    'missing-task',
    acquisitionGroup.tasks[0]!.id,
  ]
  const presentationGroup = model.task_groups[1]!

  assert.deepEqual(
    projectCampaignModelGraph(model, acquisitionGroup.id).edges.filter(
      ({ target }) => target === acquisitionGroup.tasks[0]!.id,
    ),
    [],
  )
  assert.equal(
    projectCampaignModelGraph(model, presentationGroup.id).edges.some(
      ({ data }) => data?.isDependencyEdge === true,
    ),
    false,
  )
})

test('uses canonical tasks when a mixed-case editor task renders as a capability', () => {
  const model = loadModel()
  const sourceTask = structuredClone(model.task_groups[0]!.tasks[3]!)
  const editorTask = structuredClone(model.task_groups[0]!.tasks[0]!)
  editorTask.id = 'mixed-case-code-task'
  editorTask.hierarchy = 'CoDe'
  editorTask.capability = 'Notebook Helper'
  editorTask.operation_id = 'run-cell'
  editorTask.event_name = null
  editorTask.task_dependencies = [sourceTask.id]
  editorTask.manual_input_values = { authored: 'preserved' }
  delete editorTask.code_data
  const storedEdge = {
    id: 'stored-editor-only-edge',
    source: sourceTask.id,
    target: editorTask.id,
    sourceHandle: 'bottom',
    targetHandle: 'top',
    type: 'baseCampaignEdge',
    reconnectable: true,
    data: {
      data_mapping: [{ source_parameter: 'result', target_parameter: 'input' }],
      isDependencyEdge: true,
      unknown_edge_data_property: 'preserve-edge-data',
    },
    unknown_edge_property: 'preserve-edge',
  }
  const group = model.task_groups[0]!
  group.tasks = [sourceTask, editorTask]
  group.ui_edges = [storedEdge]

  const graph = projectCampaignModelGraph(model, group.id)
  const projectedEditorTask = graph.nodes.find(
    ({ id }) => id === editorTask.id,
  )!
  const projectedEdge = graph.edges[0]!

  assert.equal(projectedEditorTask.type, 'capability')
  assert.equal(projectedEdge.data?.isDependencyEdge, false)
  assert.equal(projectedEdge.source, storedEdge.source)
  assert.equal(projectedEdge.target, storedEdge.target)
  assert.equal(projectedEdge.sourceHandle, storedEdge.sourceHandle)
  assert.equal(projectedEdge.targetHandle, storedEdge.targetHandle)
  assert.deepEqual(
    projectedEdge.data?.data_mapping,
    storedEdge.data.data_mapping,
  )
  assert.equal(
    projectedEdge.data?.unknown_edge_data_property,
    'preserve-edge-data',
  )
  assert.equal(
    (projectedEdge as Record<string, unknown>).unknown_edge_property,
    'preserve-edge',
  )

  const staleFlaggedEdges = [
    {
      ...projectedEdge,
      data: { ...projectedEdge.data, isDependencyEdge: true },
    },
  ]
  const serialized = serializeCampaignModelGraph(
    model,
    group.id,
    graph.nodes,
    staleFlaggedEdges,
  )
  const serializedGroup = serialized.task_groups[0]!
  const serializedEditorTask = serializedGroup.tasks.find(
    ({ id }) => id === editorTask.id,
  )!

  assert.deepEqual(serializedEditorTask.task_dependencies, [])
  assert.equal(serializedEditorTask.hierarchy, editorTask.hierarchy)
  assert.equal(serializedEditorTask.capability, editorTask.capability)
  assert.deepEqual(
    serializedEditorTask.manual_input_values,
    editorTask.manual_input_values,
  )
  assert.deepEqual(serializedEditorTask.output, editorTask.output)
  assert.deepEqual(serializedGroup.ui_edges, staleFlaggedEdges)
})

test('round-trips executable dependencies from the complete projected edge list', () => {
  const model = loadModel()
  const group = model.task_groups[0]!
  const graph = projectCampaignModelGraph(model, group.id)
  const serialized = serializeCampaignModelGraph(
    model,
    group.id,
    graph.nodes,
    graph.edges,
  )
  const serializedGroup = serialized.task_groups[0]!

  assert.deepEqual(
    serializedGroup.tasks.map(({ task_dependencies }) =>
      [...task_dependencies].sort(),
    ),
    group.tasks.map(({ task_dependencies }) => [...task_dependencies].sort()),
  )
  const mappedEdge = serializedGroup.ui_edges!.find(
    ({ id }) => id === 'canonical-edge-count-capability',
  )!
  assert.deepEqual(mappedEdge.data?.data_mapping, [
    { source_parameter: 'sample', target_parameter: 'sample' },
  ])
  assert.equal(
    mappedEdge.data?.unknown_edge_data_property,
    'preserve-canonical-edge-data-extension',
  )
})

test('serialization deduplicates, deletes, and transfers explicit dependencies', () => {
  const model = loadModel()
  const group = model.task_groups[0]!
  const graph = projectCampaignModelGraph(model, group.id)
  const onceToCapability = graph.edges.find(
    ({ source, target }) =>
      source === 'canonical-event-once' && target === 'canonical-capability',
  )!
  const editedEdges = [
    ...graph.edges.filter(
      ({ source, target }) =>
        !(
          source === 'canonical-event-count' &&
          target === 'canonical-event-persistent'
        ) &&
        !(
          source === 'canonical-event-persistent' &&
          target === 'canonical-capability'
        ),
    ),
    { ...onceToCapability, id: 'duplicate-dependency' },
    {
      ...onceToCapability,
      id: 'reversed-dependency',
      source: 'canonical-event-persistent',
      target: 'canonical-event-count',
    },
  ]
  const serialized = serializeCampaignModelGraph(
    model,
    group.id,
    graph.nodes,
    editedEdges,
  )
  const tasks = new Map(
    serialized.task_groups[0]!.tasks.map((task) => [task.id, task]),
  )

  assert.deepEqual(tasks.get('canonical-event-count')!.task_dependencies, [
    'canonical-event-once',
    'canonical-event-persistent',
  ])
  assert.deepEqual(
    tasks.get('canonical-event-persistent')!.task_dependencies,
    [],
  )
  assert.deepEqual(tasks.get('canonical-capability')!.task_dependencies, [
    'canonical-event-count',
    'canonical-event-once',
  ])
})

test('serialization ignores handle-shaped edges without explicit classification', () => {
  const model = loadModel()
  const group = model.task_groups[0]!
  const graph = projectCampaignModelGraph(model, group.id)
  const edges = graph.edges.map((edge) =>
    edge.source === 'canonical-event-once' &&
    edge.target === 'canonical-event-count'
      ? { ...edge, data: { ...edge.data, isDependencyEdge: false } }
      : edge,
  )
  const serialized = serializeCampaignModelGraph(
    model,
    group.id,
    graph.nodes,
    edges,
  )

  assert.deepEqual(serialized.task_groups[0]!.tasks[1]!.task_dependencies, [])
})

test('builds the temporary React Flow context without changing identity', () => {
  const model = loadModel()
  const group = model.task_groups[0]!
  const graph = projectCampaignModelGraph(model, group.id)
  const context = buildCampaignModelContextGraph(
    model,
    graph.nodes,
    graph.edges,
  )
  assert.equal(context.campaignId, model.id)
  assert.equal(context.campaignName, model.name)
  assert.equal(context.nodes.length, graph.nodes.length)
})
