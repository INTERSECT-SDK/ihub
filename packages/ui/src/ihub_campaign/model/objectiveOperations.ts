import type {
  CampaignModel,
  CampaignObjectiveAssert,
  CampaignObjectiveIterate,
  CampaignObjectiveThreshold,
} from '@ihub/utils/types/campaign'
import { v4 as uuidv4 } from 'uuid'

export type TaskGroupObjective =
  | CampaignObjectiveAssert
  | CampaignObjectiveIterate
export type TaskGroupObjectiveKind = 'assert' | 'iterate'
export type ThresholdObjectiveKind = 'upper_limit' | 'range'
export type UnifiedObjectiveKind =
  | TaskGroupObjectiveKind
  | ThresholdObjectiveKind
export type UnifiedObjectiveEntry =
  | { scope: 'task_group'; objective: TaskGroupObjective }
  | { scope: 'threshold'; objective: CampaignObjectiveThreshold }

const OBJECTIVE_VARIABLE_VALUE_SEPARATOR = ':::'

export function encodeObjectiveVariableOptionValue(
  taskId: string,
  variablePath: string,
): string {
  return `${taskId}${OBJECTIVE_VARIABLE_VALUE_SEPARATOR}${variablePath}`
}

export function decodeObjectiveVariableOptionValue(value: string): string {
  const separatorIndex = value.indexOf(OBJECTIVE_VARIABLE_VALUE_SEPARATOR)
  return separatorIndex === -1
    ? value
    : value.slice(separatorIndex + OBJECTIVE_VARIABLE_VALUE_SEPARATOR.length)
}

function normalizeObjectiveValueType(valueType: string | null): string {
  return (valueType ?? '')
    .trim()
    .toLowerCase()
    .replaceAll(' ', '')
    .replaceAll('typing.', '')
}

export function isBooleanObjectiveValueType(valueType: string | null): boolean {
  const normalized = normalizeObjectiveValueType(valueType)
  return (
    normalized === 'bool' ||
    normalized === 'boolean' ||
    normalized.includes('bool') ||
    normalized.includes('boolean')
  )
}

export function isNumericObjectiveValueType(valueType: string | null): boolean {
  const normalized = normalizeObjectiveValueType(valueType)
  if (normalized.endsWith('[]') || normalized.startsWith('array')) return false
  return ['int', 'integer', 'float', 'number', 'double'].some(
    (candidate) => normalized === candidate || normalized.includes(candidate),
  )
}

export function getThresholdTargetBounds(type: ThresholdObjectiveKind): {
  min: number
  max: number
  step: number
  defaultValue: number
} {
  return type === 'upper_limit'
    ? { min: 1, max: 20, step: 1, defaultValue: 1 }
    : { min: 1.63, max: 3.13, step: 0.01, defaultValue: 2 }
}

export function normalizeThresholdTarget(
  type: ThresholdObjectiveKind,
  target: number,
): number {
  const bounds = getThresholdTargetBounds(type)
  const clamped = Math.min(bounds.max, Math.max(bounds.min, target))
  return type === 'upper_limit'
    ? Math.round(clamped)
    : Number(clamped.toFixed(2))
}

export function isObjectiveIterate(
  objective: TaskGroupObjective,
): objective is CampaignObjectiveIterate {
  return objective.type === 'iterate' || 'iterations' in objective
}

export function createTaskGroupObjective(
  kind: TaskGroupObjectiveKind,
  id = uuidv4(),
): TaskGroupObjective {
  return kind === 'iterate'
    ? { id, type: 'iterate', iterations: 1 }
    : { id, type: 'assert', var: '', target: true }
}

export function convertTaskGroupObjectiveKind(
  objective: TaskGroupObjective,
  kind: TaskGroupObjectiveKind,
): TaskGroupObjective {
  if (objective.type === kind) return objective
  return kind === 'iterate'
    ? { id: objective.id, type: 'iterate', iterations: 1 }
    : { id: objective.id, type: 'assert', var: '', target: true }
}

function updateTaskGroupObjectives(
  campaignModel: CampaignModel,
  taskGroupId: string,
  updater: (objectives: TaskGroupObjective[]) => TaskGroupObjective[] | null,
): CampaignModel {
  const taskGroup = campaignModel.task_groups.find(
    ({ id }) => id === taskGroupId,
  )
  if (!taskGroup) return campaignModel
  const nextObjectives = updater(taskGroup.objectives)
  if (!nextObjectives) return campaignModel
  return {
    ...campaignModel,
    task_groups: campaignModel.task_groups.map((group) =>
      group.id === taskGroupId
        ? { ...group, objectives: nextObjectives }
        : group,
    ),
  }
}

export function addTaskGroupObjective(
  campaignModel: CampaignModel,
  taskGroupId: string,
  kind: TaskGroupObjectiveKind = 'assert',
  objectiveId = uuidv4(),
): CampaignModel {
  return updateTaskGroupObjectives(campaignModel, taskGroupId, (objectives) => [
    ...objectives,
    createTaskGroupObjective(kind, objectiveId),
  ])
}

export function updateAssertObjective(
  campaignModel: CampaignModel,
  taskGroupId: string,
  objectiveId: string,
  patch: Partial<CampaignObjectiveAssert>,
): CampaignModel {
  return updateTaskGroupObjectives(campaignModel, taskGroupId, (objectives) => {
    const index = objectives.findIndex(
      (objective) =>
        objective.id === objectiveId && !isObjectiveIterate(objective),
    )
    if (index === -1) return null
    return objectives.map((objective, candidateIndex) =>
      candidateIndex === index
        ? { ...objective, type: 'assert', ...patch }
        : objective,
    )
  })
}

export function updateIterateObjective(
  campaignModel: CampaignModel,
  taskGroupId: string,
  objectiveId: string,
  patch: Partial<CampaignObjectiveIterate>,
): CampaignModel {
  return updateTaskGroupObjectives(campaignModel, taskGroupId, (objectives) => {
    const index = objectives.findIndex(
      (objective) =>
        objective.id === objectiveId && isObjectiveIterate(objective),
    )
    if (index === -1) return null
    return objectives.map((objective, candidateIndex) =>
      candidateIndex === index && isObjectiveIterate(objective)
        ? {
            ...objective,
            type: 'iterate',
            ...patch,
            iterations:
              patch.iterations == null
                ? objective.iterations
                : Math.max(1, patch.iterations),
          }
        : objective,
    )
  })
}

export function updateThresholdObjective(
  campaignModel: CampaignModel,
  objectiveId: string,
  patch: Partial<CampaignObjectiveThreshold>,
): CampaignModel {
  const objectives = campaignModel.objectives
  const index =
    objectives?.threshold.findIndex(({ id }) => id === objectiveId) ?? -1
  if (!objectives || index === -1) return campaignModel
  return {
    ...campaignModel,
    objectives: {
      ...objectives,
      threshold: objectives.threshold.map((objective, candidateIndex) => {
        if (candidateIndex !== index) return objective
        const next = { ...objective, ...patch } as CampaignObjectiveThreshold
        return {
          ...next,
          target: normalizeThresholdTarget(next.type, next.target),
        } as CampaignObjectiveThreshold
      }),
    },
  }
}

export function getUnifiedObjectives(
  campaignModel: CampaignModel,
  taskGroupId: string | null,
): UnifiedObjectiveEntry[] {
  if (!taskGroupId) return []
  const group = campaignModel.task_groups.find(({ id }) => id === taskGroupId)
  if (!group) return []
  return [
    ...group.objectives.map((objective) => ({
      scope: 'task_group' as const,
      objective,
    })),
    ...(campaignModel.objectives?.threshold ?? [])
      .filter((objective) => objective.task_group === taskGroupId)
      .map((objective) => ({ scope: 'threshold' as const, objective })),
  ]
}

export function changeUnifiedObjectiveKind(
  campaignModel: CampaignModel,
  taskGroupId: string,
  objectiveId: string,
  scope: UnifiedObjectiveEntry['scope'],
  kind: UnifiedObjectiveKind,
): CampaignModel {
  const group = campaignModel.task_groups.find(({ id }) => id === taskGroupId)
  if (!group) return campaignModel

  if (scope === 'task_group' && (kind === 'assert' || kind === 'iterate')) {
    return updateTaskGroupObjectives(
      campaignModel,
      taskGroupId,
      (objectives) => {
        const source = objectives.find(({ id }) => id === objectiveId)
        if (!source) return null
        const converted = convertTaskGroupObjectiveKind(source, kind)
        if (converted === source) return null
        return objectives.map((objective) =>
          objective.id === objectiveId ? converted : objective,
        )
      },
    )
  }

  if (scope === 'threshold' && (kind === 'upper_limit' || kind === 'range')) {
    return updateThresholdObjective(campaignModel, objectiveId, { type: kind })
  }

  const currentObjectives = campaignModel.objectives ?? {
    max_runtime: [],
    threshold: [],
  }

  if (scope === 'task_group') {
    const source = group.objectives.find(({ id }) => id === objectiveId)
    if (!source || kind === 'assert' || kind === 'iterate') return campaignModel
    const bounds = getThresholdTargetBounds(kind)
    return {
      ...campaignModel,
      task_groups: campaignModel.task_groups.map((candidate) =>
        candidate.id === taskGroupId
          ? {
              ...candidate,
              objectives: candidate.objectives.filter(
                ({ id }) => id !== objectiveId,
              ),
            }
          : candidate,
      ),
      objectives: {
        max_runtime: currentObjectives.max_runtime,
        threshold: [
          ...currentObjectives.threshold,
          {
            id: objectiveId,
            var: isObjectiveIterate(source) ? '' : source.var,
            type: kind,
            target: normalizeThresholdTarget(kind, bounds.defaultValue),
            task_group: taskGroupId,
          },
        ],
      },
    }
  }

  const source = currentObjectives.threshold.find(
    ({ id }) => id === objectiveId,
  )
  if (!source || kind === 'upper_limit' || kind === 'range')
    return campaignModel
  const taskObjective =
    kind === 'iterate'
      ? createTaskGroupObjective('iterate', objectiveId)
      : {
          id: objectiveId,
          type: 'assert' as const,
          var: source.var,
          target: true,
        }
  return {
    ...campaignModel,
    task_groups: campaignModel.task_groups.map((candidate) =>
      candidate.id === taskGroupId
        ? { ...candidate, objectives: [...candidate.objectives, taskObjective] }
        : candidate,
    ),
    objectives: {
      max_runtime: currentObjectives.max_runtime,
      threshold: currentObjectives.threshold.filter(
        ({ id }) => id !== objectiveId,
      ),
    },
  }
}

export function removeUnifiedObjective(
  campaignModel: CampaignModel,
  taskGroupId: string,
  objectiveId: string,
  scope: UnifiedObjectiveEntry['scope'],
): CampaignModel {
  if (scope === 'task_group') {
    return updateTaskGroupObjectives(
      campaignModel,
      taskGroupId,
      (objectives) =>
        objectives.some(({ id }) => id === objectiveId)
          ? objectives.filter(({ id }) => id !== objectiveId)
          : null,
    )
  }
  if (
    !campaignModel.objectives?.threshold.some(({ id }) => id === objectiveId)
  ) {
    return campaignModel
  }
  return {
    ...campaignModel,
    objectives: {
      ...campaignModel.objectives,
      threshold: campaignModel.objectives.threshold.filter(
        ({ id }) => id !== objectiveId,
      ),
    },
  }
}
