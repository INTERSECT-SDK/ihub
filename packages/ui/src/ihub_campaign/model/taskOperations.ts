import type {
  Capability,
  CampaignModel,
  CampaignTask,
  CampaignTaskGroup,
} from '@ihub/utils/types/campaign'
import { v4 as uuidv4 } from 'uuid'

export const VISUALIZATION_CONFIG_KEY = '__visualization_config'
export const VISUALIZATION_NAME_KEY = '__visualization_name'

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** Creates a canonical empty task group. */
export function createCampaignTaskGroup(id = uuidv4()): CampaignTaskGroup {
  return { id, group_dependencies: [], tasks: [], objectives: [] }
}

/** Appends a task group while preserving the input model. */
export function addCampaignTaskGroup(
  campaignModel: CampaignModel,
  taskGroup = createCampaignTaskGroup(),
): CampaignModel {
  return {
    ...campaignModel,
    task_groups: [...campaignModel.task_groups, taskGroup],
  }
}

/** Appends a task only when its target group exists. */
export function addCampaignTask(
  campaignModel: CampaignModel,
  taskGroupId: string,
  task: CampaignTask,
): CampaignModel {
  if (!campaignModel.task_groups.some(({ id }) => id === taskGroupId)) {
    return campaignModel
  }
  return {
    ...campaignModel,
    task_groups: campaignModel.task_groups.map((group) =>
      group.id === taskGroupId
        ? { ...group, tasks: [...group.tasks, task] }
        : group,
    ),
  }
}

export function createCapabilityTask(
  capability: Capability,
  endpoint: string,
  id = uuidv4(),
): CampaignTask {
  return {
    id,
    hierarchy: 'capability',
    capability: capability.name,
    operation_id: endpoint,
    event_name: null,
    output: null,
    input: null,
    task_dependencies: [],
    task_objectives: null,
    capability_metadata: cloneJson(capability),
    endpoint_channel: cloneJson(
      capability.endpoints_schema.endpoints[endpoint],
    ),
  }
}

export function createEventTask(
  capability: Capability,
  eventName: string,
  id = uuidv4(),
): CampaignTask {
  return {
    id,
    hierarchy: 'capability',
    capability: capability.name,
    operation_id: null,
    event_name: eventName,
    event_mode: 'once',
    event_count: null,
    output: null,
    input: null,
    task_dependencies: [],
    task_objectives: null,
    capability_metadata: cloneJson(capability),
  }
}

export function createVisualizationTask(
  visualizationType: string,
  visualizationName: string,
  id = uuidv4(),
): CampaignTask {
  return {
    id,
    hierarchy: 'visualization',
    capability: 'Visualization',
    operation_id: visualizationType,
    event_name: null,
    output: null,
    input: null,
    task_dependencies: [],
    task_objectives: null,
    manual_input_values: {
      [VISUALIZATION_CONFIG_KEY]: {},
      [VISUALIZATION_NAME_KEY]: visualizationName,
    },
  }
}

export function createRendererTask(
  rendererType: string,
  rendererName: string,
  id = uuidv4(),
): CampaignTask {
  return {
    ...createVisualizationTask(rendererType, rendererName, id),
    hierarchy: 'renderer',
    capability: 'Renderer',
  }
}

export function createJsonFileTask(id = uuidv4()): CampaignTask {
  return {
    id,
    hierarchy: 'json-file',
    capability: 'JSON File',
    operation_id: 'source',
    event_name: null,
    output: null,
    input: null,
    task_dependencies: [],
    task_objectives: null,
    json_file_data: { name: 'JSON File', manifest: [] },
  }
}

export function createJsonTextTask(id = uuidv4()): CampaignTask {
  return {
    id,
    hierarchy: 'json-text',
    capability: 'JSON Text',
    operation_id: 'source',
    event_name: null,
    output: null,
    input: null,
    task_dependencies: [],
    task_objectives: null,
    json_text_data: { name: 'JSON Text', manifest: [] },
  }
}
