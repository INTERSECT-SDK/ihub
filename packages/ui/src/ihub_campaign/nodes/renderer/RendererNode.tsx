import { useMemo } from 'react'
import { Badge, Tabs, Text, type ComboboxData } from '@mantine/core'
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch'
import type {
  ImageRendererNode,
  TextRendererNode,
} from '@ihub/utils/types/campaign'
import type { JupyterServerConfig } from '@ihub/utils/types/notebook'
import type { VariableItem } from '@ihub/utils/types/types'
import { IHubIconImage, IHubIconText } from '@ihub/utils/icons'

import BaseNode from '../common/BaseNode'
import { defaultNodeStyle, nodeStyleMap } from '../common/nodeStyles'
import { useUpstreamVariables } from '../upstream/useUpstreamVariables'
import {
  buildUpstreamVariableOptions,
  type CampaignNodeWithData,
} from '../upstream/variableOptions'
import { useCampaign } from '../../state/campaignContext'
import { VisualizationConfiguration } from '../visualization/VisualizationConfiguration'
import { useVisualizationResolution } from '../visualization/useVisualizationResolution'
import { RendererRegistryByType } from '../../../ihub_visualization/RegisteredRenderers'
import { useCampaignView } from '../../state/campaignViewContext'
import { emptyRendererPreviewStyle, textPreviewStyle } from './rendererStyles'
import { useControlledVisualizationMappings } from '../visualization/useControlledVisualizationMappings'

type RendererNodeData = ImageRendererNode | TextRendererNode

type RendererNodeProps<TData extends RendererNodeData> = {
  id: string
  data: TData
  jupyterServers: JupyterServerConfig[]
  onDelete: () => void
}

function imageSource(value: unknown): string | null {
  if (typeof value === 'string') {
    if (value.startsWith('data:image/')) return value
    if (value.startsWith('base64,')) return `data:image/png;${value}`
    const trimmed = value.trim()
    if (/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed) && trimmed.length > 20) {
      return `data:image/png;base64,${trimmed}`
    }
    return null
  }

  if (Array.isArray(value) && value.every((byte) => Number.isInteger(byte))) {
    const bytes = Uint8Array.from(value as number[])
    let binary = ''
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte)
    })
    return `data:image/png;base64,${btoa(binary)}`
  }

  return null
}

function displayText(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function ImageViewerNode({
  id,
  data,
  jupyterServers,
  onDelete,
}: RendererNodeProps<ImageRendererNode>) {
  return (
    <RendererNode
      id={id}
      data={data}
      jupyterServers={jupyterServers}
      onDelete={onDelete}
    />
  )
}

export function TextRendererNode({
  id,
  data,
  jupyterServers,
  onDelete,
}: RendererNodeProps<TextRendererNode>) {
  return (
    <RendererNode
      id={id}
      data={data}
      jupyterServers={jupyterServers}
      onDelete={onDelete}
    />
  )
}

function RendererNode({
  id,
  data,
  jupyterServers,
  onDelete,
}: RendererNodeProps<RendererNodeData>) {
  const { background, border, iconBackground } =
    nodeStyleMap.visualization || defaultNodeStyle
  const isImage = data.type === 'image-renderer'
  const Icon = isImage ? IHubIconImage : IHubIconText
  const { parentsOutputItems: availableInputs, codeNodeConnectionsRef } =
    useUpstreamVariables({ nodeId: id, includeJsonFileSources: true })
  const { provenanceKey } = useCampaignView()

  return (
    <BaseNode
      id={id}
      title={
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <div
            style={{
              backgroundColor: iconBackground,
              borderRadius: '50%',
              width: 24,
              height: 24,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              flexShrink: 0,
            }}
          >
            <Icon size={14} />
          </div>
          <div>
            <div style={{ fontWeight: 600 }}>{data.name}</div>
            {/* <div style={{ fontSize: 12, color: 'var(--mantine-color-dimmed)' }}>
                    {data.endpoint}
                  </div> */}
          </div>
        </span>
      }
      onDelete={onDelete}
      tags={
        <Badge h={20} size='xs' me='sm' color={iconBackground}>
          {isImage ? 'Image' : 'Text'}
        </Badge>
      }
      style={{ background, border }}
      handleColor={iconBackground}
      hasOutputs={false}
    >
      <RendererNodeWidget
        key={provenanceKey}
        id={id}
        data={data}
        availableInputs={availableInputs}
        parentCodeNodeConnectionsRef={codeNodeConnectionsRef}
        jupyterServers={jupyterServers}
      />
    </BaseNode>
  )
}

function RendererNodeWidget({
  id,
  data,
  availableInputs,
  parentCodeNodeConnectionsRef,
  jupyterServers,
}: {
  id: string
  data: RendererNodeData
  availableInputs: Record<string, VariableItem[]>
  parentCodeNodeConnectionsRef: React.MutableRefObject<
    Record<string, WebSocket>
  >
  jupyterServers: JupyterServerConfig[]
}) {
  const [mappings, setMappings] = useControlledVisualizationMappings(id)
  const { state: campaignState } = useCampaign()
  const { readOnly } = useCampaignView()
  const campaignNodes = campaignState.nodes as CampaignNodeWithData[]
  const registryEntry = RendererRegistryByType[data.type]
  const options = useMemo<ComboboxData>(
    () => buildUpstreamVariableOptions(availableInputs, campaignNodes),
    [availableInputs, campaignNodes],
  )
  const { data: resolvedData, sourceIterations } = useVisualizationResolution({
    id,
    mappings,
    campaignNodes,
    parentCodeNodeConnectionsRef,
    jupyterServers,
  })

  const inputKey = data.type === 'image-renderer' ? 'image' : 'text'
  const value = resolvedData[inputKey]
  const text = data.type === 'text-renderer' ? displayText(value) : ''
  const renderedImageSource =
    data.type === 'image-renderer' ? imageSource(value) : null
  const hasRenderedOutput =
    data.type === 'image-renderer'
      ? renderedImageSource !== null
      : value !== undefined && value !== null
  const outputIteration = hasRenderedOutput
    ? (sourceIterations[inputKey] ?? null)
    : null

  return (
    <Tabs
      defaultValue='preview'
      style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
    >
      <Tabs.List grow>
        <Tabs.Tab value='configuration'>Configuration</Tabs.Tab>
        <Tabs.Tab value='preview'>Preview</Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel
        value='preview'
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          padding: '8px',
          minHeight: 0,
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {outputIteration !== null && (
          <Text
            size='xs'
            c='dimmed'
            style={{
              position: 'absolute',
              top: 4,
              right: 8,
              zIndex: 1,
              borderRadius: 4,
              padding: '2px 6px',
              background: 'var(--mantine-color-body)',
              pointerEvents: 'none',
            }}
          >
            (Output from Iteration {outputIteration})
          </Text>
        )}
        {data.type === 'image-renderer' ? (
          renderedImageSource ? (
            <TransformWrapper
              minScale={1}
              maxScale={5}
              limitToBounds={true}
              panning={{ disabled: false, allowLeftClickPan: true }}
              wheel={{ step: 0.05 }}
            >
              <TransformComponent
                wrapperStyle={{ width: '100%', height: '100%' }}
                contentStyle={{ width: '100%', height: '100%' }}
              >
                <img
                  src={renderedImageSource}
                  alt='Rendered campaign output'
                  draggable={false}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                  }}
                />
              </TransformComponent>
            </TransformWrapper>
          ) : (
            <div style={emptyRendererPreviewStyle}>
              <IHubIconImage size={48} />
            </div>
          )
        ) : value === undefined ? (
          <div style={emptyRendererPreviewStyle}>
            <IHubIconText size={48} />
          </div>
        ) : (
          <div
            style={{
              flex: 1,
              width: '100%',
              minWidth: 0,
              minHeight: 0,
              boxSizing: 'border-box',
              display: 'flex',
              justifyContent: 'center',
              whiteSpace: 'pre-wrap',
              overflowY: 'auto',
              overflowX: 'hidden',
              overflowWrap: 'anywhere',
              margin: 0,
              padding: '16px',
              ...textPreviewStyle(text),
            }}
          >
            {text}
          </div>
        )}
      </Tabs.Panel>
      <Tabs.Panel value='configuration' p='sm'>
        <VisualizationConfiguration
          inputs={registryEntry?.inputs ?? []}
          options={options}
          mappings={mappings}
          setMappings={setMappings}
          readOnly={readOnly}
        />
      </Tabs.Panel>
    </Tabs>
  )
}
