import { BaseMessageLike } from '@langchain/core/messages'
import { Icon, IconProps } from '@tabler/icons-react'
import { ForwardRefExoticComponent, ReactElement, RefAttributes } from 'react'
// import { Edge, Node } from '@xyflow/react'

export type NavLink = {
  icon: any
  name: string
  label: string
}

// TODO: fix this so all icons (regardless of library used) have the same type
type IconTypes =
  | ForwardRefExoticComponent<IconProps & RefAttributes<Icon>>
  | any

export type Tab = {
  id: number | string
  path: string
  title: string
  name?: string
  icon?: IconTypes
  selectedCampaignSheetId?: string
  campaignSheetViewports?: Record<string, CampaignViewport>
  // view?: ReactElement
}

export type CampaignViewport = {
  x: number
  y: number
  zoom: number
}

export type NewTab = {
  id?: number | string
  title: string
  name?: string
  path: string
  // view?: ReactElement
  icon?: IconTypes
}

export type LauncherCapability = {
  label: string
  name: string
  tooltip?: string
  color?: string
  icon: any
  file_extension?: string
  view?: any
}

export type LauncherCapabilities = {
  groupName: string
  capabilities: LauncherCapability[]
}

export type StoreProfile = {
  name: string
  shortDescription: string
  longDescription: string
  project: string
  division: string
  directorate: string
  repository: string
  contact: string
  contribrutors: string[]
  website: string
  published: string
  lastUpdated: string
  brokerIPAddress: string
  brokerPort: number
  brokerProtocol: string
  icon: string
  headerImageURL: string
}

export type ServerType = 'broker' | 'database' | 'virtual_machine'

type Status =
  | 'connected'
  | 'connecting'
  | 'disconnected'
  | 'unavailable'
  | 'failed'

/**
 * Base server type.
 * @prop id: Unique identification used to query database.
 * @prop type: String literal to distinguish what type of server it is.
 * @prop hostIP: Server IP address.
 * @prop port: Server port number.
 * @prop protocol: Service protocol (e.g. amqp0.9.1).
 * @prop name: Internal name used for applicaction functions (e.g. querying, sorting, etc...).
 * @prop label: Display name.
 * @prop status: Status of the server.
 */
export type Server = {
  id?: number
  type: ServerType
  hostIP: string
  port: string
  protocol?: string
  name?: string
  label: string
  status?: Status
}

/* Note: See Broker model in backend server/models for fields. */
/**
 * Message broker type.
 * @prop username: broker username, if required.
 * @prop password: broker password, if required.
 */
export type Broker = Server & {
  username?: string
  password?: string
  orchestratorUrl?: string
  orchestratorApiKey?: string
}

export type JupyterServerConfig = {
  type: string
  url: string
  token: string
  name: string
  label: string
  status: string
}

export type JupyterSession = {
  id: string
  kernel: JupyterKernel
  name: string
  notebook: {
    path: string
    name: string
  }
  path: string
  type: string
}

export type JupyterKernel = {
  connections: number
  execution_state: string
  id: string
  last_activity: string
  name: string
}

export type AvailableKernelList = {
  [key: string]: {
    server: JupyterServerConfig
    session: JupyterSession
    new_kernel: boolean | undefined
  }
}

export type JupyterNotebookFile = {
  type: 'notebook'
  format: 'json'
  content: JupyterNotebookContent
  name: string
  [key: string]: any
}

export type JupyterNotebookContent = {
  cells: JupyterCell[]
  metadata: any
  nbformat: number
  nbformat_minor: number
}

export type JupyterCell = {
  id: string
  cell_type: 'code' | 'markdown'
  source: string
  outputs: JupyterCellOutput[]
  execution_count: number | null
  metadata: any
}

export type JupyterOutputStream = {
  output_type: 'stream'
  name: 'stdout' | 'stderr'
  text: string
}

export type JupyterOutputExecResult = {
  output_type: 'execute_result'
  execution_count: number
  data: {
    [key: string]: string
  }
  metadata: {
    [key: string]: any
  }
}

export type JupyterOutputDisplayData = {
  output_type: 'display_data'
  data: {
    [key: string]: string
  }
  metadata: {
    [key: string]: any
  }
}

export type JupyterOutputError = {
  output_type: 'error'
  ename: string
  evalue: string
  traceback: string[]
}

export type JupyterCellOutput =
  | JupyterOutputDisplayData
  | JupyterOutputStream
  | JupyterOutputExecResult
  | JupyterOutputError

/* -------------------------- Campaign Builder Types -------------------- */

export type CampaignNodeType = 'capability' | 'code' | 'visualization'

// export type CampaignParameter = {
//   name: string
//   value: any
//   valueType: string
// }

// export type CampaignNodeData = {
//   name: string
//   type: CampaignNodeType
//   capability: string
//   service: string
//   inputs: CampaignParameter[]
//   outputs: CampaignParameter[]
// }

export type Campaign = {
  name: string
  createDate: string
  lastModified: string
  nodes: CampaignNode[]
  edges: CampaignEdge[]
}

export type CampaignNodeContent = EndPointNode | CodeNode | VisualizationCell

export type CampaignNode = {
  type: CampaignNodeType
  id: string
  content: CampaignNodeContent
}

export type EndPointNode = {
  capability: Capability
  endpoint: string
  endpoint_channel: CapabilityEndpointChannel
}

export type Capability = {
  id: string
  name: string
  created_at: string
  last_lifecycle_message: string | null
  lifecycle_last_updated: string | null
  lifecycle_error: string | null
  lifecycle_error_at: string | null
  service_id: number
  endpoints_schema: {
    channels: Record<string, CapabilityEndpointChannel>
    description: string
  }
}

export type CodeNode = {
  id: string
  name: string
  kernel: JupyterSession
  server: JupyterServerConfig
  jupyterNotebook: JupyterNotebookFile
}

export type CapabilityEndpointChannel = {
  publish: {
    message: Message
  }
  subscribe: {
    message: Message
  }
  events: any[]
}

export type Message = {
  schemaFormat: string
  contentType: string
  traits: {
    $ref: string
  }
  payload: {
    type: string
  }
}

export type VisualizationCell = {}

export type CampaignEdge = {
  type: 'data' | 'action'
  source_id: string
  target_id: string
  content: DataEdge | ActionEdge
}

export type DataEdge = {}

export type ActionEdge = {}

/* -------------------------- LLM Types -------------------- */

export type ChatMessage = {
  message: BaseMessageLike & [string, string]
  display: boolean
  flowcept?: boolean
}

export enum Role {
  user = 'user',
  assistant = 'assistant',
  system = 'system',
}
