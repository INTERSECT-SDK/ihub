import type { CampaignModel } from '@ihub/utils/types/campaign'

export type CampaignModelValidationIssue = {
  path: string
  message: string
}

/** Validates canonical identity and graph references used by the editor. */
export function validateCampaignModelReferences(
  campaignModel: CampaignModel,
): CampaignModelValidationIssue[] {
  const issues: CampaignModelValidationIssue[] = []
  const groupIds = new Set<string>()
  const taskIds = new Set<string>()

  campaignModel.task_groups.forEach((group, groupIndex) => {
    const groupPath = `task_groups[${groupIndex}]`
    if (!group.id || groupIds.has(group.id)) {
      issues.push({
        path: `${groupPath}.id`,
        message: group.id
          ? `Duplicate task-group ID '${group.id}'.`
          : 'Task-group ID must not be empty.',
      })
    }
    groupIds.add(group.id)

    const localTaskIds = new Set<string>()
    group.tasks.forEach((task, taskIndex) => {
      const taskPath = `${groupPath}.tasks[${taskIndex}].id`
      if (!task.id || taskIds.has(task.id)) {
        issues.push({
          path: taskPath,
          message: task.id
            ? `Duplicate task ID '${task.id}'.`
            : 'Task ID must not be empty.',
        })
      }
      taskIds.add(task.id)
      localTaskIds.add(task.id)
    })

    group.tasks.forEach((task, taskIndex) => {
      task.task_dependencies.forEach((dependencyId, dependencyIndex) => {
        if (!localTaskIds.has(dependencyId) || dependencyId === task.id) {
          issues.push({
            path: `${groupPath}.tasks[${taskIndex}].task_dependencies[${dependencyIndex}]`,
            message:
              dependencyId === task.id
                ? `Task '${task.id}' cannot depend on itself.`
                : `Task dependency '${dependencyId}' is not in task group '${group.id}'.`,
          })
        }
      })
    })

    group.ui_edges?.forEach((edge, edgeIndex) => {
      if (!localTaskIds.has(edge.source) || !localTaskIds.has(edge.target)) {
        issues.push({
          path: `${groupPath}.ui_edges[${edgeIndex}]`,
          message: `UI edge '${edge.source}' to '${edge.target}' references a missing task.`,
        })
      }
    })
  })

  campaignModel.task_groups.forEach((group, groupIndex) => {
    group.group_dependencies.forEach((dependencyId, dependencyIndex) => {
      if (!groupIds.has(dependencyId) || dependencyId === group.id) {
        issues.push({
          path: `task_groups[${groupIndex}].group_dependencies[${dependencyIndex}]`,
          message:
            dependencyId === group.id
              ? `Task group '${group.id}' cannot depend on itself.`
              : `Task-group dependency '${dependencyId}' does not exist.`,
        })
      }
    })
  })

  for (const [collection, objectives] of [
    ['max_runtime', campaignModel.objectives?.max_runtime ?? []],
    ['threshold', campaignModel.objectives?.threshold ?? []],
  ] as const) {
    objectives.forEach((objective, index) => {
      if (!groupIds.has(objective.task_group)) {
        issues.push({
          path: `objectives.${collection}[${index}].task_group`,
          message: `Objective task group '${objective.task_group}' does not exist.`,
        })
      }
    })
  }

  return issues
}
