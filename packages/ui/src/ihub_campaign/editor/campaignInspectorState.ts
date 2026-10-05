import type { Node } from '@xyflow/react'

import type { CampaignNodeType } from '@ihub/utils/types/campaign'

export const campaignInspectorNodeTypeKeys = [
  'capability',
  'event',
  'code',
  'visualization',
  'image-renderer',
  'text-renderer',
  'json-file',
  'json-text',
] as const satisfies readonly CampaignNodeType[]

export type CampaignInspectorNodeType =
  (typeof campaignInspectorNodeTypeKeys)[number]

export type CampaignSidePanelState =
  | { mode: 'closed' }
  | { mode: 'overview'; restoreFocusNodeId?: string }
  | {
      mode: 'inspector'
      nodeId: string
      taskGroupId: string
      source: 'canvas' | 'overview'
    }

export function toggleCampaignAllNodesPanel(
  state: CampaignSidePanelState,
): CampaignSidePanelState {
  return state.mode === 'overview' ? { mode: 'closed' } : { mode: 'overview' }
}

export function openCampaignNodesList(
  state: CampaignSidePanelState,
): CampaignSidePanelState {
  return state.mode === 'inspector'
    ? { mode: 'overview', restoreFocusNodeId: state.nodeId }
    : { mode: 'overview' }
}

export function leaveCampaignInspector(
  state: CampaignSidePanelState,
): CampaignSidePanelState {
  return state.mode === 'inspector' && state.source === 'overview'
    ? { mode: 'overview', restoreFocusNodeId: state.nodeId }
    : { mode: 'closed' }
}

export function reconcileCampaignPanelAfterSelectionClear(
  state: CampaignSidePanelState,
): CampaignSidePanelState {
  if (state.mode !== 'inspector') return state
  return leaveCampaignInspector(state)
}

export function reconcileCampaignPanelAfterSheetChange(
  state: CampaignSidePanelState,
): CampaignSidePanelState {
  if (state.mode !== 'inspector') return state
  return state.source === 'overview'
    ? { mode: 'overview', restoreFocusNodeId: state.nodeId }
    : { mode: 'closed' }
}

const inspectorNodeTypes = new Set<string>(campaignInspectorNodeTypeKeys)

export const DEFAULT_CAMPAIGN_INSPECTOR_WIDTH = 420
export const PREFERRED_MIN_CAMPAIGN_INSPECTOR_WIDTH = 320
export const MAX_CAMPAIGN_INSPECTOR_WIDTH = 720
export const CAMPAIGN_INSPECTOR_RESIZE_STEP = 16

export function isCampaignInspectorNode(node: Node): boolean {
  return Boolean(node.type && inspectorNodeTypes.has(node.type))
}

/** Returns the inspector node selected by a node click, toggling the current one. */
export function getCampaignInspectorNodeIdAfterClick(
  currentNodeId: string | null,
  clickedNodeId: string,
): string | null {
  return currentNodeId === clickedNodeId ? null : clickedNodeId
}

/** Chooses the most recently selected supported node. */
export function selectCampaignInspectorNodeId(
  selectedNodes: Node[],
  selectionHistory: readonly string[],
): string | null {
  const supportedIds = new Set(
    selectedNodes.filter(isCampaignInspectorNode).map(({ id }) => id),
  )
  for (let index = selectionHistory.length - 1; index >= 0; index -= 1) {
    const nodeId = selectionHistory[index]
    if (nodeId && supportedIds.has(nodeId)) return nodeId
  }
  for (let index = selectedNodes.length - 1; index >= 0; index -= 1) {
    const node = selectedNodes[index]
    if (node && isCampaignInspectorNode(node)) return node.id
  }
  return null
}

/** Keeps pointer selection from changing the inspector until a click completes. */
export function getCampaignInspectorNodeIdAfterSelection(
  currentNodeId: string | null,
  selectedNodes: Node[],
  selectionHistory: readonly string[],
  deferToNodeClick: boolean,
): string | null {
  return deferToNodeClick
    ? currentNodeId
    : selectCampaignInspectorNodeId(selectedNodes, selectionHistory)
}

export function getCampaignInspectorMaximumWidth(workspaceWidth: number) {
  return Math.min(MAX_CAMPAIGN_INSPECTOR_WIDTH, workspaceWidth / 2)
}

export function clampCampaignInspectorWidth(
  width: number,
  workspaceWidth: number,
) {
  const maximum = Math.max(0, getCampaignInspectorMaximumWidth(workspaceWidth))
  const minimum = Math.min(PREFERRED_MIN_CAMPAIGN_INSPECTOR_WIDTH, maximum)
  return Math.min(maximum, Math.max(minimum, width))
}

export function resizeCampaignInspectorWithKeyboard(
  width: number,
  key: string,
  workspaceWidth: number,
) {
  if (key === 'ArrowLeft') {
    return clampCampaignInspectorWidth(
      width + CAMPAIGN_INSPECTOR_RESIZE_STEP,
      workspaceWidth,
    )
  }
  if (key === 'ArrowRight') {
    return clampCampaignInspectorWidth(
      width - CAMPAIGN_INSPECTOR_RESIZE_STEP,
      workspaceWidth,
    )
  }
  if (key === 'Home') {
    return clampCampaignInspectorWidth(
      PREFERRED_MIN_CAMPAIGN_INSPECTOR_WIDTH,
      workspaceWidth,
    )
  }
  if (key === 'End') {
    return clampCampaignInspectorWidth(
      MAX_CAMPAIGN_INSPECTOR_WIDTH,
      workspaceWidth,
    )
  }
  return width
}
