import type { Edge, Node } from '@xyflow/react'
import type {
  CampaignGraphData,
  CampaignEdge,
  CampaignEdgeData,
  CampaignEventMode,
  CampaignModel,
  CampaignNode,
  CampaignTask,
  CampaignTaskGroup,
  CampaignTaskGroupEdge,
  Capability,
  CapabilityEndpointChannel,
  CodeNode,
  EventNode,
  ImageRendererNode,
  JsonFileNode,
  JsonTextNode,
  PlotlyVisualizationNode,
  TextRendererNode,
  VisualizationConfig,
} from '@ihub/utils/types/campaign'

// Node's focused TypeScript test runner requires the imported file extension.
// @ts-expect-error TypeScript extensions are valid here because this package is no-emit.
import { createPlotlyVisualizationDefaults } from '../../ihub_visualization/plotly_components/plotlyRegistry.ts'

// Node's focused TypeScript test runner requires the sibling file extension.
// @ts-expect-error TypeScript extensions are valid here because this package is no-emit.
import { buildCampaignEdge } from './connections.ts'
// @ts-expect-error TypeScript extensions are valid here because this package is no-emit.
import { getLogicalCampaignTaskEdgeEndpoints } from './connections.ts'
// @ts-expect-error TypeScript extensions are valid here because this package is no-emit.
import { isExecutableCampaignTaskConnection } from './connections.ts'

const MASTER_CAMPAIGN_SHEET_ID = 'master-campaign'
const VISUALIZATION_CONFIG_KEY = '__visualization_config'
const VISUALIZATION_NAME_KEY = '__visualization_name'

type CampaignTaskGroupNodeData = CampaignTaskGroup & {
  displayLabel: string
}

function getConnectionKey(source: string, target: string): string {
  return `${source}\u0000${target}`
}

function defaultCapability(task: CampaignTask, index: number): Capability {
  return {
    id: task.id,
    name: task.capability || `Task ${index + 1}`,
    created_at: '',
    last_lifecycle_message: '',
    service_id: 0,
    endpoints_schema: { endpoints: {}, events: {}, description: '' },
  }
}

function defaultEndpointChannel(): CapabilityEndpointChannel {
  return {
    publish: {
      message: {
        schemaFormat: 'application/json',
        contentType: 'application/json',
        traits: { $ref: '' },
        payload: { type: 'object', title: 'output' },
      },
      description: '',
    },
    subscribe: {
      message: {
        schemaFormat: 'application/json',
        contentType: 'application/json',
        traits: { $ref: '' },
        payload: { type: 'object', title: 'input' },
      },
      description: '',
    },
    events: [],
  }
}

function isEventTask(task: CampaignTask): boolean {
  return Boolean(task.event_name) && !task.operation_id
}

function projectTask(task: CampaignTask, index: number): Node {
  const position = task.ui_position ?? {
    x: 80 + (index % 4) * 320,
    y: 100 + Math.floor(index / 4) * 260,
  }

  if (task.code_data) {
    return {
      id: task.id,
      type: 'code',
      data: structuredClone(task.code_data),
      position,
      width: 400,
      initialHeight: 120,
      style: { width: '400px' },
    }
  }

  if (task.hierarchy === 'visualization' || task.visualization_data) {
    const storedName = task.manual_input_values?.[VISUALIZATION_NAME_KEY]
    const storedConfig = task.manual_input_values?.[VISUALIZATION_CONFIG_KEY]
    let data: PlotlyVisualizationNode
    if (task.visualization_data) {
      data = structuredClone(task.visualization_data)
    } else {
      const visualizationType = task.operation_id ?? 'plotly-line'
      const defaults = createPlotlyVisualizationDefaults(visualizationType)
      data = {
        name:
          typeof storedName === 'string'
            ? storedName
            : `Visualization ${index + 1}`,
        type: visualizationType,
        plotlyData: defaults?.plotlyData ?? [],
        plotlyLayout: defaults?.plotlyLayout ?? {},
        config:
          typeof storedConfig === 'object' && storedConfig !== null
            ? structuredClone(storedConfig as VisualizationConfig)
            : {},
      }
    }
    return {
      id: task.id,
      type: 'visualization',
      data,
      position,
      width: 420,
      initialHeight: 120,
      style: { width: '420px' },
    }
  }

  if (task.hierarchy === 'renderer' || task.renderer_data) {
    const rendererType =
      task.renderer_data?.type === 'image-renderer' ||
      task.operation_id === 'image-renderer'
        ? 'image-renderer'
        : 'text-renderer'
    const storedName = task.manual_input_values?.[VISUALIZATION_NAME_KEY]
    const storedConfig = task.manual_input_values?.[VISUALIZATION_CONFIG_KEY]
    const data: ImageRendererNode | TextRendererNode = task.renderer_data
      ? structuredClone(task.renderer_data)
      : {
          name:
            typeof storedName === 'string'
              ? storedName
              : `Renderer ${index + 1}`,
          type: rendererType,
          config:
            typeof storedConfig === 'object' && storedConfig !== null
              ? (storedConfig as VisualizationConfig)
              : {},
        }
    return {
      id: task.id,
      type: rendererType,
      data,
      position,
      width: 420,
      initialHeight: 120,
      style: { width: '420px' },
    }
  }

  if (task.hierarchy === 'json-file' && task.json_file_data) {
    return {
      id: task.id,
      type: 'json-file',
      data: structuredClone(task.json_file_data),
      position,
      width: 400,
      initialHeight: 120,
      style: { width: '400px' },
    }
  }

  if (task.hierarchy === 'json-text' && task.json_text_data) {
    return {
      id: task.id,
      type: 'json-text',
      data: structuredClone(task.json_text_data),
      position,
      width: 400,
      initialHeight: 120,
      style: { width: '400px' },
    }
  }

  if (isEventTask(task)) {
    const capability =
      task.capability_metadata ?? defaultCapability(task, index)
    const eventName = task.event_name!
    const data: EventNode = {
      capability,
      event_name: eventName,
      event_schema:
        capability.endpoints_schema.events?.[eventName] ??
        task.output?.schema ??
        {},
      event_mode: task.event_mode ?? 'once',
      event_count: task.event_mode === 'count' ? (task.event_count ?? 1) : null,
    }
    return {
      id: task.id,
      type: 'event',
      data,
      position,
      width: 400,
      initialHeight: 120,
      style: { width: '400px' },
    }
  }

  const endpoint = task.operation_id ?? 'endpoint'
  const endpointChannel = task.endpoint_channel ?? defaultEndpointChannel()
  const storedCapability =
    task.capability_metadata ?? defaultCapability(task, index)
  const capability = storedCapability.endpoints_schema.endpoints[endpoint]
    ? storedCapability
    : {
        ...storedCapability,
        endpoints_schema: {
          ...storedCapability.endpoints_schema,
          endpoints: {
            ...storedCapability.endpoints_schema.endpoints,
            [endpoint]: endpointChannel,
          },
        },
      }
  return {
    id: task.id,
    type: 'capability',
    data: {
      capability,
      endpoint,
      endpoint_channel: endpointChannel,
      manualInputValues: task.manual_input_values,
    },
    position,
    width: 400,
    initialHeight: 120,
    style: { width: '400px' },
  }
}

function projectStoredEdge(
  storedEdge: CampaignTaskGroupEdge,
  index: number,
  isDependencyEdge: boolean,
): CampaignEdge {
  const edge = structuredClone(storedEdge)
  return {
    ...edge,
    id:
      storedEdge.id ??
      `model-edge-${storedEdge.source}-${storedEdge.target}-${index}`,
    sourceHandle: storedEdge.sourceHandle ?? 'output-right',
    targetHandle: storedEdge.targetHandle ?? 'input-left',
    type: storedEdge.type ?? 'baseCampaignEdge',
    data: {
      ...edge.data,
      isDependencyEdge,
    },
  } as CampaignEdge
}

/** Projects one CampaignModel sheet into React Flow nodes and edges. */
export function projectCampaignModelGraph(
  campaignModel: CampaignModel,
  selectedSheetId: string,
): { nodes: Node[]; edges: CampaignEdge[] } {
  if (selectedSheetId === MASTER_CAMPAIGN_SHEET_ID) {
    const nodes: Node<CampaignTaskGroupNodeData, 'taskGroup'>[] =
      campaignModel.task_groups.map((taskGroup, index) => ({
        id: taskGroup.id,
        type: 'taskGroup',
        data: {
          ...structuredClone(taskGroup),
          displayLabel: `Task Group ${index + 1}`,
        },
        position: taskGroup.ui_position ?? {
          x: 80 + (index % 4) * 320,
          y: 100 + Math.floor(index / 4) * 260,
        },
        width: 280,
        height: 120,
        style: { width: '280px' },
      }))
    const edges = campaignModel.task_groups.flatMap((taskGroup) =>
      taskGroup.group_dependencies.flatMap((dependencyId) => {
        const edge = buildCampaignEdge(
          {
            source: dependencyId,
            target: taskGroup.id,
            sourceHandle: 'output-right',
            targetHandle: 'input-left',
          },
          nodes,
          { isDependencyEdge: true },
        )
        return edge ? [edge] : []
      }),
    )
    return { nodes, edges }
  }

  const taskGroup = campaignModel.task_groups.find(
    (candidate) => candidate.id === selectedSheetId,
  )
  if (!taskGroup) return { nodes: [], edges: [] }

  const nodes = taskGroup.tasks.map(projectTask)
  const storedEdges = taskGroup.ui_edges ?? []
  const storedConnections = new Set(
    storedEdges.map((edge) => {
      const { source, target } = getLogicalCampaignTaskEdgeEndpoints(edge)
      return getConnectionKey(source, target)
    }),
  )
  const declaredDependencies = new Set(
    taskGroup.tasks.flatMap((task) =>
      task.task_dependencies.map((dependencyId) =>
        getConnectionKey(dependencyId, task.id),
      ),
    ),
  )
  const projectedStoredEdges = storedEdges.map((edge, index) => {
    const { source, target } = getLogicalCampaignTaskEdgeEndpoints(edge)
    const isDeclaredDependency = declaredDependencies.has(
      getConnectionKey(source, target),
    )
    return projectStoredEdge(
      edge,
      index,
      isDeclaredDependency &&
        isExecutableCampaignTaskConnection({ source, target }, taskGroup.tasks),
    )
  })
  const synthesizedConnections = new Set<string>()
  const synthesizedDependencyEdges = taskGroup.tasks.flatMap((task) =>
    task.task_dependencies.flatMap((dependencyId) => {
      const connectionKey = getConnectionKey(dependencyId, task.id)
      if (
        dependencyId === task.id ||
        storedConnections.has(connectionKey) ||
        synthesizedConnections.has(connectionKey) ||
        !isExecutableCampaignTaskConnection(
          { source: dependencyId, target: task.id },
          taskGroup.tasks,
        )
      ) {
        return []
      }
      synthesizedConnections.add(connectionKey)
      const edge = buildCampaignEdge(
        {
          source: dependencyId,
          target: task.id,
          sourceHandle: 'bottom',
          targetHandle: 'top',
        },
        nodes,
      )
      return edge ? [edge] : []
    }),
  )
  const edges = [...projectedStoredEdges, ...synthesizedDependencyEdges]
  return { nodes, edges }
}

function isDependencyEdge(edge: Edge): boolean {
  return (edge.data as CampaignEdgeData | undefined)?.isDependencyEdge === true
}

function serializeTask(
  task: CampaignTask,
  node: Node,
  edges: Edge[],
  retainedTasks: CampaignTask[],
): CampaignTask {
  const data = node.data as Record<string, unknown>
  const seenDependencies = new Set<string>()
  const dependencies = edges.flatMap((edge) => {
    const { source, target } = getLogicalCampaignTaskEdgeEndpoints(edge)
    if (
      target !== task.id ||
      !isDependencyEdge(edge) ||
      !isExecutableCampaignTaskConnection({ source, target }, retainedTasks) ||
      seenDependencies.has(source)
    ) {
      return []
    }
    seenDependencies.add(source)
    return [source]
  })
  const position = { x: node.position.x, y: node.position.y }

  if (node.type === 'code') {
    return {
      ...task,
      task_dependencies: dependencies,
      code_data: structuredClone(data) as unknown as CodeNode,
      ui_position: position,
    }
  }
  if (node.type === 'json-file') {
    return {
      ...task,
      task_dependencies: [],
      json_file_data: structuredClone(data) as unknown as JsonFileNode,
      ui_position: position,
    }
  }
  if (node.type === 'json-text') {
    return {
      ...task,
      task_dependencies: [],
      json_text_data: structuredClone(data) as unknown as JsonTextNode,
      ui_position: position,
    }
  }
  if (node.type === 'visualization') {
    const visualization = data as PlotlyVisualizationNode
    return {
      ...task,
      operation_id: visualization.type,
      task_dependencies: dependencies,
      visualization_data: structuredClone(visualization),
      manual_input_values: {
        ...(task.manual_input_values ?? {}),
        [VISUALIZATION_CONFIG_KEY]: visualization.config ?? {},
        [VISUALIZATION_NAME_KEY]: visualization.name,
      },
      ui_position: position,
    }
  }
  if (node.type === 'image-renderer' || node.type === 'text-renderer') {
    const renderer = data as unknown as ImageRendererNode | TextRendererNode
    return {
      ...task,
      hierarchy: 'renderer',
      capability: 'Renderer',
      operation_id: node.type,
      event_name: null,
      task_dependencies: dependencies,
      renderer_data: structuredClone(renderer),
      manual_input_values: {
        ...(task.manual_input_values ?? {}),
        [VISUALIZATION_CONFIG_KEY]: renderer.config ?? {},
        [VISUALIZATION_NAME_KEY]: renderer.name,
      },
      ui_position: position,
    }
  }
  if (node.type === 'event') {
    const event = data as unknown as EventNode
    const eventMode = (event.event_mode ?? 'once') as CampaignEventMode
    return {
      ...task,
      operation_id: null,
      event_name: event.event_name,
      event_mode: eventMode,
      event_count: eventMode === 'count' ? (event.event_count ?? 1) : null,
      capability_metadata: event.capability,
      task_dependencies: dependencies,
      ui_position: position,
    }
  }
  return {
    ...task,
    task_dependencies: dependencies,
    manual_input_values: data.manualInputValues as
      | Record<string, unknown>
      | undefined,
    ui_position: position,
  }
}

/** Serializes one React Flow sheet back into immutable CampaignModel state. */
export function serializeCampaignModelGraph(
  campaignModel: CampaignModel,
  selectedSheetId: string,
  nodes: Node[],
  edges: CampaignEdge[],
): CampaignModel {
  if (selectedSheetId === MASTER_CAMPAIGN_SHEET_ID) {
    const groupIds = new Set(nodes.map((node) => node.id))
    return {
      ...campaignModel,
      task_groups: campaignModel.task_groups
        .filter((group) => groupIds.has(group.id))
        .map((group) => {
          const node = nodes.find((candidate) => candidate.id === group.id)
          return {
            ...group,
            group_dependencies: edges
              .filter((edge) => edge.target === group.id)
              .map((edge) => edge.source)
              .filter((dependencyId) => groupIds.has(dependencyId)),
            ui_position: node
              ? { x: node.position.x, y: node.position.y }
              : group.ui_position,
          }
        }),
    }
  }

  return {
    ...campaignModel,
    task_groups: campaignModel.task_groups.map((group) => {
      if (group.id !== selectedSheetId) return group
      const taskIds = new Set(nodes.map((node) => node.id))
      const retainedTasks = group.tasks.filter((task) => taskIds.has(task.id))
      const uiEdges = edges
        .filter((edge) => taskIds.has(edge.source) && taskIds.has(edge.target))
        .map<CampaignTaskGroupEdge>((edge) => ({
          ...edge,
          data: edge.data as CampaignEdgeData,
        }))
      return {
        ...group,
        ui_edges: uiEdges,
        tasks: retainedTasks.map((task) =>
          serializeTask(
            task,
            nodes.find((node) => node.id === task.id)!,
            edges,
            retainedTasks,
          ),
        ),
      }
    }),
  }
}

/** Builds the temporary React Flow context consumed by campaign node components. */
export function buildCampaignModelContextGraph(
  campaignModel: CampaignModel,
  nodes: Node[],
  edges: CampaignEdge[],
): CampaignGraphData {
  return {
    campaignId: campaignModel.id,
    campaignName: campaignModel.name,
    nodes: nodes as CampaignNode[],
    edges,
    createdAt: '',
    updatedAt: '',
  }
}
