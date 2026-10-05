import type { CampaignModel } from '@ihub/utils/types/campaign'

// Node's focused TypeScript test runner requires the sibling file extension.
// @ts-expect-error TypeScript extensions are valid here because this package is no-emit.
import { collectTaskOutputVariablePaths } from '../editor/taskOutputVariables.ts'

type CampaignTaskGroup = CampaignModel['task_groups'][number]

function removeTaskReferences(
  taskGroup: CampaignTaskGroup,
  removedTaskIds: Set<string>,
): CampaignTaskGroup {
  return {
    ...taskGroup,
    tasks: taskGroup.tasks.map((task) => ({
      ...task,
      task_dependencies: task.task_dependencies.filter(
        (dependencyId) => !removedTaskIds.has(dependencyId),
      ),
    })),
    ...(taskGroup.ui_edges
      ? {
          ui_edges: taskGroup.ui_edges.filter(
            (edge) =>
              !removedTaskIds.has(edge.source) &&
              !removedTaskIds.has(edge.target),
          ),
        }
      : {}),
  }
}

/** Removes a task and its dependency and UI-edge references campaign-wide. */
export function deleteCampaignModelTask(
  campaignModel: CampaignModel,
  taskGroupId: string,
  taskId: string,
): CampaignModel {
  const taskGroup = campaignModel.task_groups.find(
    (candidate) => candidate.id === taskGroupId,
  )
  if (!taskGroup?.tasks.some((task) => task.id === taskId)) {
    return campaignModel
  }

  const deletedTask = taskGroup.tasks.find((task) => task.id === taskId)!
  const survivingTasks = taskGroup.tasks.filter((task) => task.id !== taskId)
  const deletedTaskOutputPaths = collectTaskOutputVariablePaths(deletedTask)
  const survivingTaskOutputPaths = new Set(
    survivingTasks.flatMap((task) => [...collectTaskOutputVariablePaths(task)]),
  )
  const orphanedOutputPaths = new Set(
    [...deletedTaskOutputPaths].filter(
      (path) => !survivingTaskOutputPaths.has(path),
    ),
  )
  const removedTaskIds = new Set([taskId])

  return {
    ...campaignModel,
    task_groups: campaignModel.task_groups.map((candidate) =>
      removeTaskReferences(
        candidate.id === taskGroupId
          ? {
              ...candidate,
              tasks: survivingTasks,
              objectives: candidate.objectives.filter(
                (objective) =>
                  !(
                    'var' in objective && orphanedOutputPaths.has(objective.var)
                  ),
              ),
            }
          : candidate,
        removedTaskIds,
      ),
    ),
    objectives: campaignModel.objectives
      ? {
          max_runtime: campaignModel.objectives.max_runtime,
          threshold: campaignModel.objectives.threshold.filter(
            (objective) =>
              objective.task_group !== taskGroupId ||
              !orphanedOutputPaths.has(objective.var),
          ),
        }
      : null,
  }
}

/**
 * Removes a task group and all references to its group and tasks campaign-wide.
 */
export function deleteCampaignModelTaskGroup(
  campaignModel: CampaignModel,
  taskGroupId: string,
): CampaignModel {
  const taskGroup = campaignModel.task_groups.find(
    (group) => group.id === taskGroupId,
  )
  if (!taskGroup) {
    return campaignModel
  }

  const removedTaskIds = new Set(taskGroup.tasks.map((task) => task.id))

  return {
    ...campaignModel,
    task_groups: campaignModel.task_groups
      .filter((group) => group.id !== taskGroupId)
      .map((group) =>
        removeTaskReferences(
          {
            ...group,
            group_dependencies: group.group_dependencies.filter(
              (dependencyId) => dependencyId !== taskGroupId,
            ),
          },
          removedTaskIds,
        ),
      ),
    objectives: campaignModel.objectives
      ? {
          max_runtime: campaignModel.objectives.max_runtime.filter(
            (objective) => objective.task_group !== taskGroupId,
          ),
          threshold: campaignModel.objectives.threshold.filter(
            (objective) => objective.task_group !== taskGroupId,
          ),
        }
      : null,
  }
}
