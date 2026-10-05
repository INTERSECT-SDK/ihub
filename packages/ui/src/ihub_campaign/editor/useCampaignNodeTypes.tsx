'use client'

import type {
  CampaignTaskGroup,
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
import { useCallback, useMemo } from 'react'

import {
  CapabilityNode,
  CodeNodePassiveCard,
  EventNode,
  ImageViewerNode,
  JupyterCodeNode,
  JsonFileNode,
  JsonTextNode,
  TextRendererNode,
  VisualizationNodeView,
} from '../nodes'
import { CampaignTaskGroupNode } from './CampaignPresentation'
import { createCampaignNodeTypes } from './CampaignNodeRegistry'
import { useCanvasCodeNodeEditorOwnership } from './CodeNodeEditorOwnershipContext'

type CampaignTaskGroupNodeData = CampaignTaskGroup & { displayLabel: string }

function CampaignCanvasCodeNode({
  id,
  data,
  onDelete,
}: {
  id: string
  data: CodeNode
  onDelete: () => void
}) {
  const canvasOwnsEditor = useCanvasCodeNodeEditorOwnership(id)

  return canvasOwnsEditor ? (
    <JupyterCodeNode id={id} data={data} onDelete={onDelete} />
  ) : (
    <CodeNodePassiveCard id={id} data={data} />
  )
}

/** Creates stable React Flow renderers for every canonical task node kind. */
export function useCampaignNodeTypes({
  projectId,
  jupyterServers,
  onOpenTaskGroup,
  onDeleteTaskGroup,
  onDeleteTask,
}: {
  projectId?: string
  jupyterServers: JupyterServerConfig[]
  onOpenTaskGroup: (taskGroupId: string) => void
  onDeleteTaskGroup: (taskGroupId: string) => void
  onDeleteTask: (taskId: string) => void
}) {
  const renderTaskGroupNode = useCallback(
    ({ id, data }: { id: string; data: CampaignTaskGroupNodeData }) => (
      <CampaignTaskGroupNode
        id={id}
        data={data}
        onOpen={() => onOpenTaskGroup(id)}
        onDelete={() => onDeleteTaskGroup(id)}
      />
    ),
    [onDeleteTaskGroup, onOpenTaskGroup],
  )
  const renderCapabilityNode = useCallback(
    ({ id, data }: { id: string; data: EndPointNode }) => (
      <CapabilityNode id={id} data={data} onDelete={() => onDeleteTask(id)} />
    ),
    [onDeleteTask],
  )
  const renderEventNode = useCallback(
    ({ id, data }: { id: string; data: EventNodeData }) => (
      <EventNode id={id} data={data} onDelete={() => onDeleteTask(id)} />
    ),
    [onDeleteTask],
  )
  const renderCodeNode = useCallback(
    ({ id, data }: { id: string; data: CodeNode }) => (
      <CampaignCanvasCodeNode
        id={id}
        data={data}
        onDelete={() => onDeleteTask(id)}
      />
    ),
    [onDeleteTask],
  )
  const renderVisualizationNode = useCallback(
    ({ id, data }: { id: string; data: PlotlyVisualizationNode }) => (
      <VisualizationNodeView
        id={id}
        data={data}
        onDelete={() => onDeleteTask(id)}
      />
    ),
    [onDeleteTask],
  )
  const renderImageRendererNode = useCallback(
    ({ id, data }: { id: string; data: ImageRendererNode }) => (
      <ImageViewerNode
        id={id}
        data={data}
        jupyterServers={jupyterServers}
        onDelete={() => onDeleteTask(id)}
      />
    ),
    [jupyterServers, onDeleteTask],
  )
  const renderTextRendererNode = useCallback(
    ({ id, data }: { id: string; data: TextRendererNodeData }) => (
      <TextRendererNode
        id={id}
        data={data}
        jupyterServers={jupyterServers}
        onDelete={() => onDeleteTask(id)}
      />
    ),
    [jupyterServers, onDeleteTask],
  )
  const renderJsonFileNode = useCallback(
    ({ id, data }: { id: string; data: JsonFileNodeData }) => (
      <JsonFileNode
        id={id}
        data={data}
        projectId={projectId}
        jupyterServers={jupyterServers}
        onDelete={() => onDeleteTask(id)}
      />
    ),
    [jupyterServers, onDeleteTask, projectId],
  )
  const renderJsonTextNode = useCallback(
    ({ id, data }: { id: string; data: JsonTextNodeData }) => (
      <JsonTextNode id={id} data={data} onDelete={() => onDeleteTask(id)} />
    ),
    [onDeleteTask],
  )

  return useMemo(
    () =>
      createCampaignNodeTypes({
        taskGroup: renderTaskGroupNode,
        capability: renderCapabilityNode,
        event: renderEventNode,
        code: renderCodeNode,
        visualization: renderVisualizationNode,
        'image-renderer': renderImageRendererNode,
        'text-renderer': renderTextRendererNode,
        'json-file': renderJsonFileNode,
        'json-text': renderJsonTextNode,
      }),
    [
      renderCapabilityNode,
      renderCodeNode,
      renderEventNode,
      renderImageRendererNode,
      renderJsonFileNode,
      renderJsonTextNode,
      renderTaskGroupNode,
      renderTextRendererNode,
      renderVisualizationNode,
    ],
  )
}
