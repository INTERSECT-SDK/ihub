import type { CampaignTask } from '@ihub/utils/types/campaign'
import { getVariablesFromNode } from '@ihub/utils/helpers/helpers'

// Node's focused TypeScript test runner requires the imported file extension.
// @ts-expect-error TypeScript extensions are valid here because this package is no-emit.
import { getCapabilityPayloadVariables } from '../schema/capabilitySchema.ts'

// Node's focused TypeScript test runner requires the sibling file extension.
// @ts-expect-error TypeScript extensions are valid here because this package is no-emit.
import * as eventSchema from '../nodes/event/eventSchema.ts'

export type TaskGroupOutputVariableGroup = {
  taskId: string
  taskLabel: string
  variables: Array<{ path: string; label: string; valueType: string | null }>
}

function isEventTask(task: CampaignTask): boolean {
  return Boolean(task.event_name) && !task.operation_id
}

function addSchemaVariables(
  group: TaskGroupOutputVariableGroup,
  schema: Record<string, unknown>,
  variablePathSet: Set<string>,
): void {
  getVariablesFromNode(schema).forEach((variableItem) => {
    if (!variableItem.path || variablePathSet.has(variableItem.path)) {
      return
    }

    group.variables.push({
      path: variableItem.path,
      label: `${variableItem.title} (${variableItem.type})`,
      valueType:
        typeof variableItem.type === 'string' ? variableItem.type : null,
    })
    variablePathSet.add(variableItem.path)
  })
}

function addOutputValueVariables(
  task: CampaignTask,
  group: TaskGroupOutputVariableGroup,
  variablePathSet: Set<string>,
): void {
  task.output?.values?.forEach((outputValue) => {
    if (
      typeof outputValue.var !== 'string' ||
      !outputValue.var ||
      variablePathSet.has(outputValue.var)
    ) {
      return
    }

    group.variables.push({
      path: outputValue.var,
      label: outputValue.var,
      valueType: null,
    })
    variablePathSet.add(outputValue.var)
  })
}

/** Collects editor-visible output variables for each campaign task. */
export function collectTaskOutputVariableGroups(
  tasks: CampaignTask[],
): TaskGroupOutputVariableGroup[] {
  const outputGroups = new Map<string, TaskGroupOutputVariableGroup>()

  tasks.forEach((task) => {
    const taskLabel =
      task.capability_metadata?.name ??
      task.capability ??
      `Task ${task.id.slice(0, 8)}`
    const taskIdentifier = task.operation_id || task.event_name || task.id
    const existingGroup = outputGroups.get(task.id)
    const group = existingGroup ?? {
      taskId: task.id,
      taskLabel: `${taskLabel} (${taskIdentifier})`,
      variables: [],
    }
    const variablePathSet = new Set(
      group.variables.map((variable) => variable.path),
    )

    if (isEventTask(task)) {
      const eventDefinition =
        task.capability_metadata?.endpoints_schema.events?.[task.event_name!] ??
        task.output?.schema
      addSchemaVariables(
        group,
        eventSchema.normalizeEventPayloadSchema(
          eventDefinition,
          eventSchema.getCapabilityEventSchemaDocument(
            task.capability_metadata,
          ),
        ),
        variablePathSet,
      )
      addOutputValueVariables(task, group, variablePathSet)
    } else {
      addOutputValueVariables(task, group, variablePathSet)

      const publishPayload = task.endpoint_channel?.publish?.message?.payload
      if (publishPayload) {
        getCapabilityPayloadVariables(
          publishPayload,
          task.capability_metadata,
        ).forEach((variableItem) => {
          if (!variableItem.path || variablePathSet.has(variableItem.path)) {
            return
          }

          group.variables.push({
            path: variableItem.path,
            label: `${variableItem.title} (${variableItem.type})`,
            valueType:
              typeof variableItem.type === 'string' ? variableItem.type : null,
          })
          variablePathSet.add(variableItem.path)
        })
      }
    }

    if (group.variables.length > 0) {
      outputGroups.set(task.id, group)
    }
  })

  return [...outputGroups.values()].sort((a, b) =>
    a.taskLabel.localeCompare(b.taskLabel),
  )
}

/** Collects the editor-visible output variable paths produced by a task. */
export function collectTaskOutputVariablePaths(
  task: CampaignTask,
): Set<string> {
  const outputGroup = collectTaskOutputVariableGroups([task])[0]

  return new Set(outputGroup?.variables.map((variable) => variable.path) ?? [])
}
