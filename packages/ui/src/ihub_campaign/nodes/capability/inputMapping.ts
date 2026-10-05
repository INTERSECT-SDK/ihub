import type {
  CampaignEdge,
  DataMapping,
  DataMappingList,
} from '@ihub/utils/types/campaign'

import type { CampaignNodeWithData } from '../upstream/variableOptions'
// Node's focused TypeScript runner requires the imported file extension.
// @ts-expect-error TypeScript extensions are valid because this package is no-emit.
import { parseCapabilityInputDraftValue } from '../../model/capabilityInputDrafts.ts'

const EMPTY_MANUAL_INPUT_VALUES: Record<string, unknown> = Object.freeze({})

/**
 * Returns the manual input values stored on a campaign node.
 *
 * Uses a shared empty object when no manual values are present so callers can
 * safely read from the result without creating fallback objects.
 */
export function getManualInputValues(
  node: CampaignNodeWithData | undefined,
): Record<string, unknown> {
  return (
    (node?.data?.manualInputValues as Record<string, unknown> | undefined) ??
    EMPTY_MANUAL_INPUT_VALUES
  )
}

/**
 * Converts a text field value into the value stored for manual capability input.
 *
 * Empty strings clear the manual value, numeric strings become numbers, and all
 * other input remains a string.
 */
export function parseManualInputValue(
  value: string,
): string | number | undefined {
  return parseCapabilityInputDraftValue(value)
}

/**
 * Compares two ordered data-mapping lists by source and target parameters.
 *
 * This intentionally treats order as significant because edge mapping updates
 * preserve mapping order when deciding whether state changed.
 */
export function dataMappingsAreEqual(
  currentMappings: NonNullable<CampaignEdge['data']>['data_mapping'] = [],
  nextMappings: NonNullable<CampaignEdge['data']>['data_mapping'] = [],
) {
  if (currentMappings.length !== nextMappings.length) return false
  return currentMappings.every((mapping, index) => {
    const nextMapping = nextMappings[index]
    return (
      nextMapping &&
      mapping.source_parameter === nextMapping.source_parameter &&
      mapping.target_parameter === nextMapping.target_parameter
    )
  })
}

/**
 * Removes every mapping that writes to the given target parameter path.
 */
export function removeMappingsForTargetParameter(
  mappings: NonNullable<CampaignEdge['data']>['data_mapping'] = [],
  targetPath: string,
) {
  return mappings.filter((mapping) => mapping.target_parameter !== targetPath)
}

/**
 * Inserts or replaces the mapping for a target parameter while preserving the
 * rest of the mapping list.
 *
 * Duplicate mappings for the same target are collapsed so each target parameter
 * has at most one selected upstream source.
 */
export function upsertMappingForTargetParameter(
  mappings: NonNullable<CampaignEdge['data']>['data_mapping'] = [],
  nextMapping: DataMapping,
) {
  let targetIndex = -1
  let targetMapping: DataMapping | undefined
  let hasDuplicateTarget = false
  const nextMappings: DataMappingList = []

  mappings.forEach((mapping) => {
    if (mapping.target_parameter !== nextMapping.target_parameter) {
      nextMappings.push(mapping)
      return
    }
    if (targetIndex === -1) {
      targetIndex = nextMappings.length
      targetMapping = mapping
      nextMappings.push(mapping)
      return
    }
    hasDuplicateTarget = true
  })

  if (targetIndex === -1) return [...mappings, nextMapping]
  if (
    targetMapping?.source_parameter === nextMapping.source_parameter &&
    !hasDuplicateTarget
  ) {
    return mappings
  }

  nextMappings[targetIndex] =
    targetMapping?.source_parameter === nextMapping.source_parameter
      ? targetMapping
      : nextMapping
  return nextMappings
}

/**
 * Finds the selected upstream source value for a node target parameter.
 *
 * Returns the serialized selector value used by the input-mapping UI, or null
 * when no incoming edge maps to the target path.
 */
export function getSelectedUpstreamValueForTarget(
  edges: CampaignEdge[],
  nodeId: string,
  targetPath: string,
): string | null {
  const incomingEdges = edges.filter((edge) => edge.target === nodeId)

  for (const edge of incomingEdges) {
    const mapping = (edge.data?.data_mapping || []).find(
      (candidate) =>
        candidate.target_parameter === targetPath &&
        candidate.source_parameter != null,
    )
    if (mapping && edge.source) {
      return `${edge.source}:::${mapping.source_parameter}`
    }
  }
  return null
}
