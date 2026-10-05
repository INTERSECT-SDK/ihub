import type { CampaignModel } from '@ihub/utils/types/campaign'

export type CapabilityInputDraft = {
  provenanceKey: string
  taskGroupId: string
  taskId: string
  inputPath: string
  displayValue: string
}

export type ApplyCapabilityInputDraftsOptions = {
  expectedProvenanceKey: string
  readOnly?: boolean
}

/** Converts a capability input field value to its persisted representation. */
export function parseCapabilityInputDraftValue(
  value: string,
): string | number | undefined {
  if (value === '') return undefined
  const numericValue = Number(value)
  return Number.isNaN(numericValue) ? value : numericValue
}

/**
 * Applies capability input drafts to a campaign in one immutable pass.
 *
 * Drafts from another view, drafts targeting removed tasks, and all drafts in
 * read-only views are ignored. Unchanged groups and tasks retain their exact
 * object identity.
 */
export function applyCapabilityInputDrafts(
  campaignModel: CampaignModel,
  drafts: Iterable<CapabilityInputDraft>,
  options: ApplyCapabilityInputDraftsOptions,
): CampaignModel {
  if (options.readOnly) return campaignModel

  const draftsByTask = new Map<string, CapabilityInputDraft[]>()
  for (const draft of drafts) {
    if (draft.provenanceKey !== options.expectedProvenanceKey) continue
    const key = `${draft.taskGroupId}\u0000${draft.taskId}`
    const taskDrafts = draftsByTask.get(key)
    if (taskDrafts) taskDrafts.push(draft)
    else draftsByTask.set(key, [draft])
  }
  if (draftsByTask.size === 0) return campaignModel

  let modelChanged = false
  const taskGroups = campaignModel.task_groups.map((taskGroup) => {
    let groupChanged = false
    const tasks = taskGroup.tasks.map((task) => {
      const taskDrafts = draftsByTask.get(`${taskGroup.id}\u0000${task.id}`)
      if (!taskDrafts) return task

      const currentValues = task.manual_input_values ?? {}
      let nextValues: Record<string, unknown> | undefined

      for (const draft of taskDrafts) {
        const parsedValue = parseCapabilityInputDraftValue(draft.displayValue)
        const currentValue = (nextValues ?? currentValues)[draft.inputPath]
        const hasCurrentValue = Object.hasOwn(
          nextValues ?? currentValues,
          draft.inputPath,
        )

        if (
          parsedValue === undefined
            ? !hasCurrentValue
            : hasCurrentValue && Object.is(currentValue, parsedValue)
        ) {
          continue
        }

        nextValues ??= { ...currentValues }
        if (parsedValue === undefined) delete nextValues[draft.inputPath]
        else nextValues[draft.inputPath] = parsedValue
      }

      if (!nextValues) return task
      groupChanged = true
      return { ...task, manual_input_values: nextValues }
    })

    if (!groupChanged) return taskGroup
    modelChanged = true
    return { ...taskGroup, tasks }
  })

  return modelChanged
    ? { ...campaignModel, task_groups: taskGroups }
    : campaignModel
}
