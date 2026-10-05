import type { NodeTypes } from '@xyflow/react'

export const campaignModelNodeTypeKeys = [
  'taskGroup',
  'capability',
  'event',
  'code',
  'visualization',
  'image-renderer',
  'text-renderer',
  'json-file',
  'json-text',
] as const

export type CampaignModelNodeType = (typeof campaignModelNodeTypeKeys)[number]

type CampaignModelNodeRenderers = Record<
  CampaignModelNodeType,
  NodeTypes[string]
>

/** Builds the React Flow registry while enforcing every CampaignModel node type. */
export function createCampaignNodeTypes(
  renderers: CampaignModelNodeRenderers,
): NodeTypes {
  return renderers
}
