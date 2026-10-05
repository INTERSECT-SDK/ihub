import { useCallback, type Dispatch, type SetStateAction } from 'react'

import {
  useCampaignStore,
  useCampaignStoreSelector,
} from '../../state/campaignContext'
import { useCampaignView } from '../../state/campaignViewContext'
import {
  EMPTY_VISUALIZATION_MAPPINGS,
  type VisualizationMappingState,
  visualizationMappingsAreEqual,
} from './VisualizationMapping'
import {
  commitVisualizationMappingUpdate,
  isVisualizationNodeType,
} from './visualizationMappingController'

type VisualizationNodeData = {
  config?: { input_mappings?: VisualizationMappingState }
}

/** Shares persisted visualization mappings across canvas and inspector views. */
export function useControlledVisualizationMappings(
  nodeId: string,
): [
  VisualizationMappingState,
  Dispatch<SetStateAction<VisualizationMappingState>>,
] {
  const store = useCampaignStore()
  const { provenanceKey, readOnly, canMutate } = useCampaignView()
  const mappings = useCampaignStoreSelector((snapshot) => {
    const node = snapshot.state.nodes.find(
      (candidate) => candidate.id === nodeId,
    )
    if (!node || !isVisualizationNodeType(node.type)) {
      return EMPTY_VISUALIZATION_MAPPINGS
    }
    return (
      (node.data as VisualizationNodeData).config?.input_mappings ??
      EMPTY_VISUALIZATION_MAPPINGS
    )
  }, visualizationMappingsAreEqual)

  const setMappings = useCallback<
    Dispatch<SetStateAction<VisualizationMappingState>>
  >(
    (update) => {
      if (readOnly) return
      commitVisualizationMappingUpdate({
        store,
        nodeId,
        update,
        provenanceKey,
        canMutate,
      })
    },
    [canMutate, nodeId, provenanceKey, readOnly, store],
  )

  return [mappings, setMappings]
}
