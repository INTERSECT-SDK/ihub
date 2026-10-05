import type { Node } from '@xyflow/react'
import type { CampaignEdge, CampaignModel } from '@ihub/utils/types/campaign'

import {
  projectCampaignModelGraph,
  serializeCampaignModelGraph,
  // Node's focused TypeScript test runner requires the imported file extension.
  // @ts-expect-error TypeScript extensions are valid because this package is no-emit.
} from '../graph/campaignModelProjection.ts'
import type { CampaignStoreSnapshot } from '../state/campaignStore'

export type CampaignGraphReconciliation = {
  source: 'editor' | 'model'
  nodes: Node[]
  edges: CampaignEdge[]
  campaignModel: CampaignModel
  handledEditorRevision: number
}

export type CampaignGraphScope = {
  viewIdentity: string
  selectedSheetId: string
}

/**
 * Preserves React Flow selection while replacing nodes within the same graph.
 * Selection is presentation-only, so removed nodes are never restored.
 */
export function preserveCampaignGraphSelection(
  currentNodes: Node[],
  nextNodes: Node[],
  previousScope: CampaignGraphScope | null,
  nextScope: CampaignGraphScope,
): Node[] {
  if (
    previousScope?.viewIdentity !== nextScope.viewIdentity ||
    previousScope.selectedSheetId !== nextScope.selectedSheetId
  ) {
    return nextNodes
  }

  const selectedNodeIds = new Set(
    currentNodes.filter(({ selected }) => selected).map(({ id }) => id),
  )
  if (selectedNodeIds.size === 0) return nextNodes

  return nextNodes.map((node) =>
    selectedNodeIds.has(node.id) ? { ...node, selected: true } : node,
  )
}

/**
 * Replaces stale React Flow capability inputs with their canonical model values.
 * Only nodes still present in the graph are returned, so deletions stay deleted.
 */
export function preserveCampaignModelCapabilityInputs(
  campaignModel: CampaignModel,
  selectedSheetId: string,
  nodes: Node[],
): Node[] {
  const taskGroup = campaignModel.task_groups.find(
    ({ id }) => id === selectedSheetId,
  )
  if (!taskGroup) return nodes

  const tasksById = new Map(taskGroup.tasks.map((task) => [task.id, task]))
  return nodes.map((node) => {
    if (node.type !== 'capability') return node
    const task = tasksById.get(node.id)
    if (!task) return node

    return {
      ...node,
      data: {
        ...node.data,
        manualInputValues: task.manual_input_values,
      },
    }
  })
}

/** Chooses and reconciles the newest unconsumed graph state in one pass. */
export function reconcileCampaignGraph({
  campaignModel,
  selectedSheetId,
  storeSnapshot,
  handledEditorRevision,
}: {
  campaignModel: CampaignModel
  selectedSheetId: string
  storeSnapshot: CampaignStoreSnapshot
  handledEditorRevision: number
}): CampaignGraphReconciliation {
  const hasPendingEditorRevision =
    storeSnapshot.editorRevision !== 0 &&
    storeSnapshot.editorRevision !== handledEditorRevision

  if (!hasPendingEditorRevision) {
    const { nodes, edges } = projectCampaignModelGraph(
      campaignModel,
      selectedSheetId,
    )
    return {
      source: 'model',
      nodes,
      edges,
      campaignModel,
      handledEditorRevision,
    }
  }

  const edges = storeSnapshot.state.edges as CampaignEdge[]
  const nodes = preserveCampaignModelCapabilityInputs(
    campaignModel,
    selectedSheetId,
    storeSnapshot.state.nodes as unknown as Node[],
  )
  return {
    source: 'editor',
    nodes,
    edges,
    campaignModel: serializeCampaignModelGraph(
      campaignModel,
      selectedSheetId,
      nodes,
      edges,
    ),
    handledEditorRevision: storeSnapshot.editorRevision,
  }
}
