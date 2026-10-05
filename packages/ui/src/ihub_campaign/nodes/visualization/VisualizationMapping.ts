import type { VisualizationInputMapping } from '@ihub/utils/types/campaign'

export type VisualizationMappingState = Record<
  string,
  VisualizationInputMapping | string | null
>

export const EMPTY_VISUALIZATION_MAPPINGS: VisualizationMappingState = {}

export type NormalizedVisualizationMappings = Record<
  string,
  VisualizationInputMapping | null
>

/** Converts widget values into the persisted visualization mapping shape. */
export function normalizeVisualizationMappings(
  mappings: VisualizationMappingState,
): NormalizedVisualizationMappings {
  return Object.fromEntries(
    Object.entries(mappings).map(([key, value]) => [
      key,
      typeof value === 'string'
        ? parseVisualizationMappingValue(value)
        : (value ?? null),
    ]),
  )
}

/** Compares visualization mappings by input and source rather than identity. */
export function visualizationMappingsAreEqual(
  left: VisualizationMappingState,
  right: VisualizationMappingState,
): boolean {
  const normalizedLeft = normalizeVisualizationMappings(left)
  const normalizedRight = normalizeVisualizationMappings(right)
  const leftKeys = Object.keys(normalizedLeft)
  const rightKeys = Object.keys(normalizedRight)
  if (leftKeys.length !== rightKeys.length) return false

  return leftKeys.every((key) => {
    const leftMapping = normalizedLeft[key]
    const rightMapping = normalizedRight[key]
    return (
      leftMapping?.sourceNodeId === rightMapping?.sourceNodeId &&
      leftMapping?.sourcePath === rightMapping?.sourcePath
    )
  })
}

/** Keeps historical displays owned by their snapshot instead of local state. */
export function getDisplayedVisualizationMappings(
  snapshotMappings: VisualizationMappingState,
  localMappings: VisualizationMappingState,
  readOnly: boolean,
): VisualizationMappingState {
  return readOnly ? snapshotMappings : localMappings
}

/**
 * Counts visualization inputs that have a usable upstream mapping value.
 */
export function countVisualizationMappings(
  mappings: VisualizationMappingState,
): number {
  return Object.values(mappings).filter((mapping) => {
    if (typeof mapping === 'string') return mapping.length > 0
    return Boolean(mapping?.sourceNodeId && mapping.sourcePath)
  }).length
}

/**
 * Parses a serialized visualization mapping value into its source node and
 * source path components.
 */
export function parseVisualizationMappingValue(value: string | null): {
  sourceNodeId: string
  sourcePath: string
} | null {
  const parts = value?.split(':::') ?? []
  const sourceNodeId = parts[0]
  const sourcePath = parts.length > 1 ? parts.slice(1).join(':::') : ''
  return sourceNodeId && sourcePath ? { sourceNodeId, sourcePath } : null
}

/**
 * Merges resolved mapping values into the first configured Plotly trace.
 */
export function buildVisualizationPlotData(
  mappings: VisualizationMappingState,
  resolvedData: Record<string, unknown>,
  fallbackPlotData: Record<string, unknown>[] | undefined,
) {
  const trace: Record<string, unknown> = {}

  Object.entries(mappings).forEach(([inputKey, mapping]) => {
    if (!mapping) return
    const rawPath =
      typeof mapping === 'string' ? mapping : (mapping.sourcePath ?? '')
    const parsedPath = rawPath.includes(':::')
      ? rawPath.split(':::')[1]
      : rawPath
    if (!parsedPath) return

    const resolvedValue =
      resolvedData[inputKey] !== undefined
        ? resolvedData[inputKey]
        : resolvedData[parsedPath]
    if (resolvedValue !== undefined) trace[inputKey] = resolvedValue
  })

  // console.log('buildVisualizationPlotData', { mappings, resolvedData, trace })
  if (Object.keys(trace).length === 0) return fallbackPlotData
  return [{ ...(fallbackPlotData?.[0] || {}), ...trace }]
}
