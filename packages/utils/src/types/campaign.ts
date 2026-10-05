import { Spec } from 'vega'
import {
  JupyterCodeCell,
  JupyterServerConfig,
  JupyterSession,
} from './notebook'
import type { Node, Edge } from '@xyflow/react'
import type { Data, Layout } from 'plotly.js'
import type {
  Campaign as GeneratedCampaign,
  Input as GeneratedCampaignInput,
  MaxRuntime1 as GeneratedCampaignObjectiveMaxRuntime,
  Objective as GeneratedCampaignObjective,
  ObjectiveAssert as GeneratedCampaignObjectiveAssert,
  ObjectiveIterate as GeneratedCampaignObjectiveIterate,
  Output as GeneratedCampaignOutput,
  Task as GeneratedCampaignTask,
  TaskGroup3 as GeneratedCampaignTaskGroup,
  ThresholdRange as GeneratedCampaignObjectiveThresholdRange,
  ThresholdUpperLimit as GeneratedCampaignObjectiveThresholdUpperLimit,
  Value as GeneratedCampaignValue,
} from './generated/campaign-contract'

/**
 * Supported node kinds used in campaign flow graphs.
 */
export type CampaignNodeType =
  | 'capability'
  | 'event'
  | 'code'
  | 'visualization'
  | 'image-renderer'
  | 'text-renderer'
  | 'json-file'
  | 'json-text'

/**
 * Temporary React Flow projection of a canonical campaign model.
 */
export type CampaignGraphData = {
  campaignId: string
  campaignName: string
  nodes: CampaignNode[]
  edges: CampaignEdge[]
  createdAt: string
  updatedAt: string
}

/**
 * Serializable campaign file envelope for the orchestrator campaign model.
 */
export type CampaignModelFile = {
  type: 'file'
  format: 'text'
  content: CampaignModel
  name: string
  [key: string]: unknown
}

/**
 * Input or output parameter definition used by campaign nodes.
 */
export type CampaignParameter = {
  title: string
  type: string
  description?: string
  default_value?: any
  value: any
}

/**
 * Union of all supported campaign node payload types.
 */
export type CampaignNodeContent =
  | EndPointNode
  | EventNode
  | CodeNode
  | PlotlyVisualizationNode
  | ImageRendererNode
  | TextRendererNode
  | JsonFileNode
  | JsonTextNode

/**
 * Campaign objective upper-limit threshold.
 */
export type CampaignObjectiveThresholdUpperLimit = Pick<
  GeneratedCampaignObjectiveThresholdUpperLimit,
  'id' | 'var' | 'type' | 'target' | 'task_group'
>

/**
 * Campaign objective bounded range threshold.
 */
export type CampaignObjectiveThresholdRange = Pick<
  GeneratedCampaignObjectiveThresholdRange,
  'id' | 'var' | 'type' | 'target' | 'task_group'
>

/**
 * Campaign objective runtime budget.
 */
export type CampaignObjectiveMaxRuntime = Pick<
  GeneratedCampaignObjectiveMaxRuntime,
  'id' | 'max_time' | 'task_group'
>

/**
 * Supported threshold variants in the orchestrator campaign schema.
 */
export type CampaignObjectiveThreshold =
  | CampaignObjectiveThresholdUpperLimit
  | CampaignObjectiveThresholdRange

/**
 * Campaign objective configuration.
 */
export type CampaignObjective = {
  max_runtime: NonNullable<GeneratedCampaignObjective['max_runtime']>
  threshold: NonNullable<GeneratedCampaignObjective['threshold']>
}

/**
 * Value binding used by orchestrator inputs and outputs.
 */
export type CampaignValue = Pick<GeneratedCampaignValue, 'id' | 'var'>

/**
 * Orchestrator input schema wrapper.
 */
export type CampaignInput = Pick<GeneratedCampaignInput, 'schema'> & {
  values: CampaignValue[]
}

/**
 * Orchestrator output schema wrapper.
 */
export type CampaignOutput = Pick<GeneratedCampaignOutput, 'schema'> & {
  values: CampaignValue[]
}

/**
 * Assertion objective for a task group.
 */
export type CampaignObjectiveAssert = Pick<
  GeneratedCampaignObjectiveAssert,
  'id' | 'type' | 'var' | 'target'
>

/**
 * Iteration objective for a task group.
 */
export type CampaignObjectiveIterate = Pick<
  GeneratedCampaignObjectiveIterate,
  'id' | 'type' | 'iterations'
>

/**
 * Campaign task definition.
 */
export type CampaignTask = Pick<
  GeneratedCampaignTask,
  | 'capability'
  | 'event_count'
  | 'event_name'
  | 'hierarchy'
  | 'id'
  | 'operation_id'
> & {
  event_mode?: CampaignEventMode
  input?: CampaignInput | null
  output?: CampaignOutput | null
  task_dependencies: string[]
  task_objectives?: CampaignObjective | null
  capability_metadata?: Capability
  endpoint_channel?: CapabilityEndpointChannel
  manual_input_values?: Record<string, unknown>
  /** Frontend-owned JSON source metadata for non-executable file nodes. */
  json_file_data?: JsonFileNode
  /** Frontend-owned JSON source metadata for non-executable text nodes. */
  json_text_data?: JsonTextNode
  /** Frontend-owned notebook code metadata for editor-only code tasks. */
  code_data?: CodeNode
  /** Frontend-owned visualization metadata for editor-only visualization tasks. */
  visualization_data?: PlotlyVisualizationNode
  /** Frontend-owned renderer metadata for editor-only renderer tasks. */
  renderer_data?: ImageRendererNode | TextRendererNode
  ui_position?: {
    x: number
    y: number
  }
}

export type CampaignTaskGroupEdge = {
  id?: string
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
  type?: string
  data?: CampaignEdgeData
  [key: string]: unknown
}

/**
 * Orchestrator task group definition.
 */
export type CampaignTaskGroup = Pick<GeneratedCampaignTaskGroup, 'id'> & {
  group_dependencies: string[]
  tasks: CampaignTask[]
  objectives: Array<CampaignObjectiveAssert | CampaignObjectiveIterate>
  ui_edges?: CampaignTaskGroupEdge[]
  ui_position?: {
    x: number
    y: number
  }
}

/**
 * Canonical persisted representation of an orchestrator campaign.
 */
export type CampaignModel = Pick<
  GeneratedCampaign,
  'description' | 'id' | 'name' | 'user'
> & {
  run_id: string
  task_groups: CampaignTaskGroup[]
  objectives: CampaignObjective | null
  inputs: CampaignInput[]
  outputs: CampaignOutput[]
  selected_broker_id?: string | number | null
}

/**
 * Mutable runtime fields stored alongside node-specific campaign data.
 */
export type CampaignNodeRuntimeData = {
  manualInputValues?: Record<string, unknown>
  outputs?: CampaignParameter[]
}

/**
 * React Flow node data stored directly under `node.data`.
 */
export type CampaignNodeData = CampaignNodeContent & CampaignNodeRuntimeData

/**
 * Top-level node output list updated by campaign context actions.
 */
export type CampaignNodeOutputData = NonNullable<CampaignNodeData['outputs']>

/**
 * React Flow node shape used for campaign editor rendering.
 */
export type CampaignNode = Node<CampaignNodeData, CampaignNodeType>

/**
 * Node payload describing a capability endpoint connection.
 */
export type EndPointNode = {
  capability: Capability
  endpoint: string
  endpoint_channel: CapabilityEndpointChannel
}

/** Supported INTERSECT event-listener completion modes. */
export type CampaignEventMode = NonNullable<GeneratedCampaignTask['event_mode']>

/** Event definition advertised by a capability lifecycle schema. */
export type CapabilityEventDefinition = Record<string, unknown>

/** Reusable JSON schemas advertised alongside capability endpoints and events. */
export type CapabilitySchemaDefinitions = Record<
  string,
  CapabilityEventDefinition
>

/** Node payload describing an INTERSECT event listener. */
export type EventNode = {
  capability: Capability
  event_name: string
  event_schema: CapabilityEventDefinition
  event_mode: CampaignEventMode
  event_count: number | null
}

/**
 * Capability metadata returned by orchestrator lifecycle APIs.
 */
export type Capability = {
  id: string
  name: string
  created_at: string
  last_lifecycle_message: string
  service_id: number
  endpoints_schema: {
    endpoints: Record<string, CapabilityEndpointChannel>
    events?: Record<string, CapabilityEventDefinition>
    components?: {
      schemas?: CapabilitySchemaDefinitions
      [key: string]: unknown
    }
    description: string
    [key: string]: unknown
  }
}

/**
 * Node payload for executable notebook code in a campaign.
 */
export type CodeNode = {
  id: string
  name: string
  kernel: JupyterSession
  server: JupyterServerConfig
  cell: JupyterCodeCell
}

/** Stable credential-free reference to a JSON file in Project Files. */
export type JsonFileReference = {
  projectId: string
  path: string
  jupyterServerId: string | number
}

/** JSON value types that can participate in capability input mappings. */
export type JsonFileFieldType =
  | 'string'
  | 'boolean'
  | 'integer'
  | 'number'
  | 'null'
  | 'object'
  | 'string[]'
  | 'boolean[]'
  | 'integer[]'
  | 'number[]'
  | 'null[]'
  | 'object[]'

/** One recursively addressable field exposed by a JSON file node. */
export type JsonFileField = {
  pointer: string
  displayName: string
  type: JsonFileFieldType | null
  unsupportedReason?: string
}

/** Frontend-owned source node backed by a live Project Files JSON document. */
export type JsonFileNode = {
  name: string
  fileReference?: JsonFileReference
  manifest: JsonFileField[]
  contentHash?: string
}

/** Frontend-owned source node backed by typed JSON text. */
export type JsonTextNode = {
  name: string
  textContent?: string
  manifest: JsonFileField[]
}

/**
 * Publish/subscribe channel schema for a capability endpoint.
 */
export type CapabilityEndpointChannel = {
  publish: {
    message: Message
    description: string
  }
  subscribe: {
    message: Message
    description: string
  }
  events: any[]
}

/**
 * Message schema definition used by capability channels.
 */
export type Message = {
  schemaFormat: string
  contentType: string
  traits: {
    $ref: string
  }
  payload: {
    $ref?: string
    type?: string
    title?: string
    description?: string
    properties?: Record<string, any>
    items?: any
  }
}

/**
 * Maps a visualization input field to a source node path.
 */
export type VisualizationInputMapping = {
  sourceNodeId: string
  sourcePath: string
}

/**
 * Optional runtime configuration for visualization nodes.
 */
export type VisualizationConfig = {
  input_mappings?: Record<string, VisualizationInputMapping | null>
}

/**
 * Node payload describing a Vega/Vega-Lite visualization.
 */
export type VegaVisualizationNode = {
  name: string
  type: string
  spec: Spec
  config: VisualizationConfig
}

/**
 * Node payload describing a Plotly visualization.
 */
export type PlotlyVisualizationNode = {
  name: string
  type: string
  plotlyData: Partial<Data>[]
  plotlyLayout: Partial<Layout>
  config: VisualizationConfig
}

/** Node payload for rendering image bytes from an upstream value. */
export type ImageRendererNode = {
  name: string
  type: 'image-renderer'
  config: VisualizationConfig
}

/** Node payload for rendering text from an upstream value. */
export type TextRendererNode = {
  name: string
  type: 'text-renderer'
  config: VisualizationConfig
}

/**
 * Collection of edge-level parameter mappings.
 */
export type DataMappingList = DataMapping[]

/**
 * Direction used by horizontal campaign edge rendering.
 */
export type CampaignEdgeHorizontalDirection = 'left' | 'right'

/**
 * Maps a source parameter name to a target parameter name.
 */
export type DataMapping = {
  source_parameter: string
  target_parameter: string
}

/**
 * React Flow edge data stored directly under `edge.data`.
 */
export type CampaignEdgeData = {
  data_mapping?: DataMappingList
  isFeedback?: boolean
  isOrthogonal?: boolean
  isDependencyEdge?: boolean
  horizontalDirection?: CampaignEdgeHorizontalDirection
  [key: string]: unknown
}

/**
 * Campaign edge extension with optional parameter mapping metadata.
 */
export type CampaignEdge = Edge<CampaignEdgeData>

/**
 * Service metadata discovered from lifecycle messages.
 */
export type Service = {
  name: string
  created_at: string
  last_lifecycle_message: string
  organization: string
  facility: string
  ystem: string
  id: number | string
}

/**
 * Broker connection details used by orchestration workflows.
 */
export type Broker = {
  label: string
  id: string | number
  hostIP: string
  port: number
  protocol: string
  username?: string
  orchestratorUrl?: string
  status?: string
  autoConnectEnabled?: boolean
}

/**
 * MCP server configuration used by campaign integrations.
 */
export type MCPServer = {
  label: string
  id: string | number
  url: string
  status?: string
}

/**
 * Must match LifecycleMessagePublic schema in models/lifecycle_message.py
 */
export type LifecycleMessage = {
  broker_id: number
  endpoint_names: string
  created_at: string
  last_updated: string
  facility: string
  message_id: string
  organization: string
  sdk_capability_name: string
  service: string
  system: string
  subsystem: string | null
}

/**
 * Event payload delivered for campaign orchestration updates.
 */
export type OrchestratorEvent = {
  campaign_id: string
  event_type: string
  payload?: any
}
