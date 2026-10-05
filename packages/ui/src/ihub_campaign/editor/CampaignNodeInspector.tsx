'use client'

import type {
  CodeNode,
  EndPointNode,
  EventNode as EventNodeData,
  ImageRendererNode,
  JsonFileNode as JsonFileNodeData,
  JsonTextNode as JsonTextNodeData,
  PlotlyVisualizationNode,
  TextRendererNode as TextRendererNodeData,
} from '@ihub/utils/types/campaign'
import type { JupyterServerConfig } from '@ihub/utils/types/notebook'
import type { Node } from '@xyflow/react'
import { useMemo, type RefObject } from 'react'

import {
  CapabilityNode,
  EventNode,
  ImageViewerNode,
  JupyterCodeNode,
  JsonFileNode,
  JsonTextNode,
  TextRendererNode,
  VisualizationNodeView,
} from '../nodes'
import { CampaignNodeRenderProvider } from './CampaignNodeRenderContext'
import { campaignInspectorNodeTypeKeys } from './campaignInspectorState'

type InspectorRenderer = (node: Node) => React.ReactNode
type CampaignInspectorRenderers = Record<
  (typeof campaignInspectorNodeTypeKeys)[number],
  InspectorRenderer
>

export function createCampaignInspectorRenderers(
  renderers: CampaignInspectorRenderers,
) {
  return renderers
}

type CampaignNodeInspectorProps = {
  node: Node
  headingRef: RefObject<HTMLHeadingElement | null>
  projectId?: string
  jupyterServers: JupyterServerConfig[]
  onBack?: () => void
  backLabel?: string
  onClose: () => void
  onDelete: (nodeId: string) => void
}

/** Renders the selected task's full editor in a resizable workspace panel. */
export function CampaignNodeInspector({
  node,
  headingRef,
  projectId,
  jupyterServers,
  onBack,
  backLabel,
  onClose,
  onDelete,
}: CampaignNodeInspectorProps) {
  const renderers = useMemo(
    () =>
      createCampaignInspectorRenderers({
        capability: (selectedNode) => (
          <CapabilityNode
            id={selectedNode.id}
            data={selectedNode.data as EndPointNode}
            onDelete={() => onDelete(selectedNode.id)}
          />
        ),
        event: (selectedNode) => (
          <EventNode
            id={selectedNode.id}
            data={selectedNode.data as EventNodeData}
            onDelete={() => onDelete(selectedNode.id)}
          />
        ),
        code: (selectedNode) => (
          <JupyterCodeNode
            id={selectedNode.id}
            data={selectedNode.data as CodeNode}
            onDelete={() => onDelete(selectedNode.id)}
          />
        ),
        visualization: (selectedNode) => (
          <VisualizationNodeView
            id={selectedNode.id}
            data={selectedNode.data as PlotlyVisualizationNode}
            onDelete={() => onDelete(selectedNode.id)}
          />
        ),
        'image-renderer': (selectedNode) => (
          <ImageViewerNode
            id={selectedNode.id}
            data={selectedNode.data as ImageRendererNode}
            jupyterServers={jupyterServers}
            onDelete={() => onDelete(selectedNode.id)}
          />
        ),
        'text-renderer': (selectedNode) => (
          <TextRendererNode
            id={selectedNode.id}
            data={selectedNode.data as TextRendererNodeData}
            jupyterServers={jupyterServers}
            onDelete={() => onDelete(selectedNode.id)}
          />
        ),
        'json-file': (selectedNode) => (
          <JsonFileNode
            id={selectedNode.id}
            data={selectedNode.data as JsonFileNodeData}
            projectId={projectId}
            jupyterServers={jupyterServers}
            onDelete={() => onDelete(selectedNode.id)}
          />
        ),
        'json-text': (selectedNode) => (
          <JsonTextNode
            id={selectedNode.id}
            data={selectedNode.data as JsonTextNodeData}
            onDelete={() => onDelete(selectedNode.id)}
          />
        ),
      }),
    [jupyterServers, onDelete, projectId],
  )

  const renderer = node.type
    ? renderers[node.type as keyof CampaignInspectorRenderers]
    : undefined
  if (!renderer) return null

  return (
    <CampaignNodeRenderProvider
      value={{ mode: 'inspector', headingRef, onBack, backLabel, onClose }}
    >
      {renderer(node)}
    </CampaignNodeRenderProvider>
  )
}
