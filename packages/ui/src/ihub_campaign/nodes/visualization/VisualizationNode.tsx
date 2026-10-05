import { useMemo, useState } from 'react'
import { Badge, Tabs, type ComboboxData } from '@mantine/core'
import type { PlotlyVisualizationNode } from '@ihub/utils/types/campaign'
import type { VariableItem } from '@ihub/utils/types/types'
import { IHubIconGraph } from '@ihub/utils/icons'

import BaseNode from '../common/BaseNode'
import { defaultNodeStyle, nodeStyleMap } from '../common/nodeStyles'
import { useUpstreamVariables } from '../upstream/useUpstreamVariables'
import {
  buildUpstreamVariableOptions,
  type CampaignNodeWithData,
} from '../upstream/variableOptions'
import { useCampaign } from '../../state/campaignContext'
import {
  defaultPlotlyLayout,
  PlotlyVisualizationRegistryByType,
} from '../../../ihub_visualization/plotly_components/plotlyRegistry'
import { PlotlyPreview } from './PlotlyPreview'
import { VisualizationConfiguration } from './VisualizationConfiguration'
import { buildVisualizationPlotData } from './VisualizationMapping'
import { useVisualizationResolution } from './useVisualizationResolution'
import { useCampaignView } from '../../state/campaignViewContext'
import { useControlledVisualizationMappings } from './useControlledVisualizationMappings'

/** Renders a campaign visualization node and its configuration/preview panel. */
export default function VisualizationNodeView({
  id,
  data,
  onDelete,
}: {
  id: string
  data: PlotlyVisualizationNode
  onDelete: () => void
}) {
  const { background, border, iconBackground } =
    nodeStyleMap['visualization'] || defaultNodeStyle
  const [isHovered, setIsHovered] = useState(false)
  const { parentsOutputItems: availableInputs, codeNodeConnectionsRef } =
    useUpstreamVariables({
      nodeId: id,
      includeJsonFileSources: false,
    })
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
            <IHubIconGraph size={14} />
          </div>
          <div style={{ fontWeight: 600 }}>{data.name}</div>
        </span>
      }
      onDelete={onDelete}
      tags={[
        <Badge
          h={20}
          key='visualization-tag'
          size='xs'
          me='sm'
          color={iconBackground}
        >
          Visualization
        </Badge>,
      ]}
      style={{
        background,
        border,
        boxShadow: isHovered
          ? '0 0 12px rgba(255, 255, 255, 0.1), 0 8px 16px rgba(0, 0, 0, 0.15)'
          : 'none',
        transition: 'box-shadow 0.2s',
      }}
      handleColor={iconBackground}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      hasOutputs={false}
    >
      <VisualizationNodeWidget
        key={provenanceKey}
        id={id}
        availableInputs={availableInputs}
        data={data}
        parentCodeNodeConnectionsRef={codeNodeConnectionsRef}
      />
    </BaseNode>
  )
}

function VisualizationNodeWidget({
  id,
  availableInputs,
  data,
  parentCodeNodeConnectionsRef,
}: {
  id: string
  availableInputs: Record<string, VariableItem[]>
  data: PlotlyVisualizationNode
  parentCodeNodeConnectionsRef: React.MutableRefObject<
    Record<string, WebSocket>
  >
}) {
  const { iconBackground } = nodeStyleMap['visualization'] || defaultNodeStyle
  const [mappings, setMappings] = useControlledVisualizationMappings(id)
  const { state: campaignState } = useCampaign()
  const { readOnly } = useCampaignView()
  const campaignNodes = campaignState.nodes as CampaignNodeWithData[]
  const registryEntry = PlotlyVisualizationRegistryByType[data.type]
  const configInputs = registryEntry?.inputs ?? []

  const options = useMemo<ComboboxData>(
    () => buildUpstreamVariableOptions(availableInputs, campaignNodes || []),
    [availableInputs, campaignNodes],
  )
  const { data: resolvedData } = useVisualizationResolution({
    id,
    mappings,
    campaignNodes,
    parentCodeNodeConnectionsRef,
  })
  const resolvedPlotData = useMemo(
    () => buildVisualizationPlotData(mappings, resolvedData, data.plotlyData),
    [data.plotlyData, mappings, resolvedData],
  )

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        minHeight: 0,
        minWidth: 0,
      }}
    >
      <Tabs
        defaultValue='visualization'
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          minWidth: 0,
        }}
      >
        <Tabs.List grow style={{ flexShrink: 0 }}>
          <Tabs.Tab color={iconBackground} value='configuration'>
            Configuration
          </Tabs.Tab>
          <Tabs.Tab color={iconBackground} value='visualization'>
            Visualization
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel
          value='visualization'
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            padding: 0,
            minHeight: 0,
            minWidth: 0,
            overflow: 'hidden',
          }}
        >
          <PlotlyPreview
            data={resolvedPlotData}
            layout={data.plotlyLayout || defaultPlotlyLayout}
          />
        </Tabs.Panel>
        <Tabs.Panel
          value='configuration'
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            padding: '12px',
            minHeight: 0,
            minWidth: 0,
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              height: '100%',
              width: '100%',
              overflow: 'auto',
            }}
          >
            <VisualizationConfiguration
              inputs={configInputs}
              options={options}
              mappings={mappings}
              setMappings={setMappings}
              readOnly={readOnly}
            />
          </div>
        </Tabs.Panel>
      </Tabs>
    </div>
  )
}
