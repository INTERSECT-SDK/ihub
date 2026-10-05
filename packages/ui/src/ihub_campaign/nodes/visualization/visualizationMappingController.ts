import type {
  ImageRendererNode,
  PlotlyVisualizationNode,
  TextRendererNode,
} from '@ihub/utils/types/campaign'
import type { SetStateAction } from 'react'

import type { CampaignStore } from '../../state/campaignStore'
import type { VisualizationMappingState } from './VisualizationMapping'
// Node's focused TypeScript runner requires the imported file extension.
// @ts-expect-error TypeScript extensions are valid because this package is no-emit.
import * as VisualizationMappingModule from './VisualizationMapping.ts'

const {
  EMPTY_VISUALIZATION_MAPPINGS,
  normalizeVisualizationMappings,
  visualizationMappingsAreEqual,
} = VisualizationMappingModule

type VisualizationNodeData =
  | PlotlyVisualizationNode
  | ImageRendererNode
  | TextRendererNode

export type VisualizationMappingUpdate =
  SetStateAction<VisualizationMappingState>

export function isVisualizationNodeType(type: string | undefined): boolean {
  return (
    type === 'visualization' ||
    type === 'image-renderer' ||
    type === 'text-renderer'
  )
}

/**
 * Applies a user mapping edit against the latest campaign node.
 *
 * Returning false means the edit was stale, read-only, redundant, or no
 * longer targeted a visualization-compatible node.
 */
export function commitVisualizationMappingUpdate({
  store,
  nodeId,
  update,
  provenanceKey,
  canMutate,
}: {
  store: CampaignStore
  nodeId: string
  update: VisualizationMappingUpdate
  provenanceKey: string
  canMutate: (scheduledProvenanceKey?: string) => boolean
}): boolean {
  if (!canMutate(provenanceKey)) return false

  const currentNode = store
    .getSnapshot()
    .state.nodes.find((node) => node.id === nodeId)
  if (!currentNode || !isVisualizationNodeType(currentNode.type)) return false

  const currentData = currentNode.data as VisualizationNodeData
  const currentMappings =
    currentData.config?.input_mappings ?? EMPTY_VISUALIZATION_MAPPINGS
  const requestedMappings =
    typeof update === 'function' ? update(currentMappings) : update
  const normalizedMappings = normalizeVisualizationMappings(requestedMappings)

  if (visualizationMappingsAreEqual(currentMappings, normalizedMappings)) {
    return false
  }

  store.dispatch({
    type: 'UPDATE_NODE_DATA',
    payload: {
      nodeId,
      updatedNodeData: {
        ...currentData,
        config: {
          ...(currentData.config ?? {}),
          input_mappings: normalizedMappings,
        },
      },
    },
  })
  return true
}
