'use client'

import {
  Background,
  ConnectionMode,
  Controls,
  ReactFlow,
  type ReactFlowProps,
  type Viewport,
} from '@xyflow/react'
import { useCallback, useLayoutEffect, useState } from 'react'

import BaseCampaignEdge from '../edges/BaseCampaignEdge'
import {
  defaultCampaignViewport,
  getCampaignSheetViewport,
} from './campaignViewport'

const edgeTypes = {
  baseCampaignEdge: BaseCampaignEdge,
}

type CampaignCanvasProps = Pick<
  ReactFlowProps,
  | 'nodes'
  | 'edges'
  | 'nodeTypes'
  | 'onNodesChange'
  | 'onEdgesChange'
  | 'onNodeDragStop'
  | 'onConnectStart'
  | 'onConnectEnd'
  | 'onConnect'
  | 'isValidConnection'
  | 'onReconnectStart'
  | 'onReconnect'
  | 'onReconnectEnd'
  | 'onSelectionChange'
  | 'onNodeClick'
  | 'onPointerDown'
  | 'onPaneClick'
> & {
  readOnly: boolean
  selectedSheetId?: string
  sheetViewports?: Readonly<Record<string, Viewport>>
  onSheetViewportChange?: (sheetId: string, viewport: Viewport) => void
}

/** Renders the CampaignModel graph with edit controls gated by view mode. */
export function CampaignCanvas({
  nodes,
  edges,
  nodeTypes,
  onNodesChange,
  onEdgesChange,
  onNodeDragStop,
  onConnectStart,
  onConnectEnd,
  onConnect,
  isValidConnection,
  onReconnectStart,
  onReconnect,
  onReconnectEnd,
  onSelectionChange,
  onNodeClick,
  onPointerDown,
  onPaneClick,
  readOnly,
  selectedSheetId,
  sheetViewports,
  onSheetViewportChange,
}: CampaignCanvasProps) {
  const controlsViewport =
    selectedSheetId !== undefined && onSheetViewportChange !== undefined
  const savedViewport = selectedSheetId
    ? sheetViewports?.[selectedSheetId]
    : undefined
  const [viewport, setViewport] = useState<Viewport>(() =>
    selectedSheetId
      ? getCampaignSheetViewport(selectedSheetId, sheetViewports)
      : { ...defaultCampaignViewport },
  )

  useLayoutEffect(() => {
    if (controlsViewport && selectedSheetId) {
      setViewport(getCampaignSheetViewport(selectedSheetId, sheetViewports))
    }
  }, [
    controlsViewport,
    savedViewport?.x,
    savedViewport?.y,
    savedViewport?.zoom,
    selectedSheetId,
    sheetViewports,
  ])

  const handleMoveEnd = useCallback(
    (_event: MouseEvent | TouchEvent | null, nextViewport: Viewport) => {
      if (selectedSheetId) {
        onSheetViewportChange?.(selectedSheetId, nextViewport)
      }
    },
    [onSheetViewportChange, selectedSheetId],
  )

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      connectionMode={ConnectionMode.Loose}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      defaultEdgeOptions={{ reconnectable: !readOnly }}
      nodesDraggable={!readOnly}
      nodesConnectable={!readOnly}
      deleteKeyCode={readOnly ? null : ['Backspace', 'Delete']}
      onNodesChange={readOnly ? undefined : onNodesChange}
      onEdgesChange={readOnly ? undefined : onEdgesChange}
      onNodeDragStop={readOnly ? undefined : onNodeDragStop}
      onConnectStart={readOnly ? undefined : onConnectStart}
      onConnectEnd={readOnly ? undefined : onConnectEnd}
      onConnect={readOnly ? undefined : onConnect}
      isValidConnection={isValidConnection}
      onReconnectStart={readOnly ? undefined : onReconnectStart}
      onReconnect={readOnly ? undefined : onReconnect}
      onReconnectEnd={readOnly ? undefined : onReconnectEnd}
      onSelectionChange={onSelectionChange}
      onNodeClick={onNodeClick}
      nodeClickDistance={0}
      onPointerDown={onPointerDown}
      onPaneClick={onPaneClick}
      defaultViewport={defaultCampaignViewport}
      viewport={controlsViewport ? viewport : undefined}
      onViewportChange={controlsViewport ? setViewport : undefined}
      onMoveEnd={controlsViewport ? handleMoveEnd : undefined}
    >
      <Controls />
      <Background />
    </ReactFlow>
  )
}
