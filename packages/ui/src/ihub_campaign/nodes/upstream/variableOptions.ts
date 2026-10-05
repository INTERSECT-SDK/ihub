import type { ComboboxData } from '@mantine/core'
import type { VariableItem } from '@ihub/utils/types/types'
import {
  normalizeVariableType,
  variableTypesAreCompatible,
} from '@ihub/utils/helpers/variableTypes'

export { normalizeVariableType, variableTypesAreCompatible }

export type CampaignNodeWithData = {
  id: string
  type?: string
  data?: Record<string, unknown>
}

export type UpstreamOptionCompatibility =
  | 'compatible'
  | 'incompatible'
  | 'unresolved'

export function buildUpstreamOptionValue(
  sourceNodeId: string,
  sourcePath: string,
): string {
  return `${sourceNodeId}:::${sourcePath}`
}

export function parseUpstreamOptionValue(value: string): {
  sourceNodeId: string
  sourcePath: string
} {
  const delimiterIndex = value.indexOf(':::')
  if (delimiterIndex === -1) return { sourceNodeId: value, sourcePath: '' }
  return {
    sourceNodeId: value.slice(0, delimiterIndex),
    sourcePath: value.slice(delimiterIndex + 3),
  }
}

function comboboxItemIsEnabled(item: ComboboxData[number]): boolean {
  if (typeof item === 'string') return true
  if ('items' in item) return item.items.some(comboboxItemIsEnabled)
  return item.disabled !== true
}

export function comboboxDataHasEnabledOption(data: ComboboxData): boolean {
  return data.some(comboboxItemIsEnabled)
}

export function getUpstreamOptionCompatibility({
  value,
  targetInput,
  parentsOutputItems = {},
}: {
  value: string | null
  targetInput: VariableItem
  parentsOutputItems?: Record<string, VariableItem[]>
}): UpstreamOptionCompatibility {
  if (!value) return 'incompatible'

  const { sourceNodeId, sourcePath } = parseUpstreamOptionValue(value)
  const sourceOutput = parentsOutputItems[sourceNodeId]?.find(
    (output) => output.path === sourcePath,
  )

  if (!sourceOutput) return 'unresolved'

  return variableTypesAreCompatible(sourceOutput.type, targetInput.type)
    ? 'compatible'
    : 'incompatible'
}

export function isCompatibleUpstreamOptionValue({
  value,
  targetInput,
  parentsOutputItems = {},
}: {
  value: string | null
  targetInput: VariableItem
  parentsOutputItems?: Record<string, VariableItem[]>
}): boolean {
  return (
    getUpstreamOptionCompatibility({
      value,
      targetInput,
      parentsOutputItems,
    }) === 'compatible'
  )
}

/** Builds grouped upstream options with compatibility applied per target. */
export function buildUpstreamVariableOptions(
  parentsOutputItems: Record<string, VariableItem[]> = {},
  nodes: CampaignNodeWithData[] = [],
  targetInput?: VariableItem,
): ComboboxData {
  const options: Array<ComboboxData[number]> = []

  for (const [sourceNodeId, outputItems] of Object.entries(
    parentsOutputItems,
  )) {
    const sourceNode = nodes.find((node) => node.id === sourceNodeId)
    let sourceNodeName = sourceNodeId

    switch (sourceNode?.type) {
      case 'capability':
        sourceNodeName = String(
          sourceNode.data?.endpoint ??
            (sourceNode.data?.capability as { name?: unknown } | undefined)
              ?.name ??
            sourceNodeId,
        )
        break
      case 'code':
        sourceNodeName = String(sourceNode.data?.name ?? sourceNodeId)
        break
      case 'json-file':
        sourceNodeName = String(
          (sourceNode.data?.fileReference as { path?: unknown } | undefined)
            ?.path ??
            sourceNode.data?.name ??
            sourceNodeId,
        )
        break
      case 'json-text':
        sourceNodeName = String(sourceNode.data?.name ?? sourceNodeId)
        break
    }

    options.push({
      group: `From ${sourceNodeName} (${sourceNodeId})`,
      items: outputItems.map((output) => ({
        value: buildUpstreamOptionValue(sourceNodeId, output.path),
        label: `${output.title} (${output.type})`,
        disabled: targetInput
          ? !variableTypesAreCompatible(output.type, targetInput.type)
          : false,
      })),
    })
  }

  return options
}

export const buildPotentialOptions = buildUpstreamVariableOptions
