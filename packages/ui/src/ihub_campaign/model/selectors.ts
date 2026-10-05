import type {
  CampaignModel,
  CampaignTask,
  CampaignTaskGroup,
} from '@ihub/utils/types/campaign'

import type { NodeStatus } from '../state/executionContext'

export type CampaignModelTab = { id: string; label: string }

/** Derives stable editor tabs from canonical task-group order. */
export function getCampaignModelTabs(
  campaignModel: CampaignModel,
): CampaignModelTab[] {
  return [
    { id: 'master-campaign', label: 'Campaign' },
    ...campaignModel.task_groups.map((taskGroup, index) => ({
      id: taskGroup.id,
      label: `Task Group ${index + 1}`,
    })),
  ]
}

/** Selects a task group without manufacturing a replacement value. */
export function getCampaignTaskGroup(
  campaignModel: CampaignModel,
  taskGroupId: string | null,
): CampaignTaskGroup | null {
  if (!taskGroupId) return null
  return campaignModel.task_groups.find(({ id }) => id === taskGroupId) ?? null
}

const editorOnlyTaskHierarchies = new Set([
  'code',
  'visualization',
  'renderer',
  'json-file',
  'json-text',
])
const editorOnlyTaskCapabilities = new Set([
  'code',
  'visualization',
  'renderer',
])

/** Returns whether a task participates in orchestrator execution. */
export function isExecutableCampaignTask(task: CampaignTask): boolean {
  return !(
    editorOnlyTaskHierarchies.has(task.hierarchy.toLowerCase()) ||
    editorOnlyTaskCapabilities.has(task.capability.toLowerCase())
  )
}

/** Selects executable tasks in their canonical task-group order. */
export function getExecutableCampaignTasks(
  taskGroup: CampaignTaskGroup,
): CampaignTask[] {
  return taskGroup.tasks.filter(isExecutableCampaignTask)
}

/** Reports whether a campaign contains work for the orchestrator. */
export function hasExecutableCampaignTasks(
  campaignModel: CampaignModel,
): boolean {
  return campaignModel.task_groups.some(
    (taskGroup) => getExecutableCampaignTasks(taskGroup).length > 0,
  )
}

/** Aggregates executable task state for a task-group badge. */
export function aggregateTaskGroupStatus(
  taskGroup: CampaignTaskGroup,
  nodeStatuses: Record<string, NodeStatus>,
): NodeStatus {
  const statuses = getExecutableCampaignTasks(taskGroup).map(
    (task) => nodeStatuses[task.id] ?? 'idle',
  )

  if (statuses.includes('executing')) return 'executing'
  if (statuses.includes('error')) return 'error'
  if (statuses.includes('aborted')) return 'aborted'
  if (statuses.includes('waiting')) return 'waiting'
  if (
    statuses.length > 0 &&
    statuses.every((status) => status === 'complete')
  ) {
    return 'complete'
  }
  return 'idle'
}

/** Returns the highest execution count reached by a task in a task group. */
export function getTaskGroupIteration(
  taskGroup: CampaignTaskGroup,
  nodeRunCounts: Record<string, number>,
): number {
  return getExecutableCampaignTasks(taskGroup).reduce(
    (iteration, task) => Math.max(iteration, nodeRunCounts[task.id] ?? 0),
    0,
  )
}
