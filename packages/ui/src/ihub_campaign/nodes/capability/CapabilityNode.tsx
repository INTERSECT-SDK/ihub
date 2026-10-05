import { useMemo, useState } from 'react'
import { Badge, Group, Input, Select, Stack, Tabs, Text } from '@mantine/core'
import type { EndPointNode } from '@ihub/utils/types/campaign'
import { defaultNodeStyle, nodeStyleMap } from '../common/nodeStyles'
import BaseNode from '../common/BaseNode'
import { IHubIconIntersect } from '@ihub/utils/icons'
import type { VariableItem } from '@ihub/utils/types/types'
import { useUpstreamVariables } from '../upstream/useUpstreamVariables'
import { InputSourceSegmentedControl } from './InputSourceSegmentedControl'
import { useCapabilityInputMapping } from './useCapabilityInputMapping'
import { getCapabilityInputItemKey } from './inputSource'
import { Position } from '@xyflow/react'
import { useCampaignView } from '../../state/campaignViewContext'

// Node's focused TypeScript test runner requires the imported file extension.
// @ts-expect-error TypeScript extensions are valid here because this package is no-emit.
import { getCapabilityPayloadVariables } from '../../schema/capabilitySchema.ts'

/**
 * Renders a capability node and exposes its declared endpoint inputs/outputs.
 *
 * The node gathers output variables from connected parent capability nodes and
 * live Jupyter code nodes so each input can be mapped to an upstream value.
 */
export default function CapabilityNode({
  id,
  data,
  onDelete,
}: {
  id: string
  data: EndPointNode
  onDelete: () => void
}) {
  const { background, border, iconBackground } =
    nodeStyleMap['intersect'] || defaultNodeStyle
  const [isHovered, setIsHovered] = useState(false)
  const { parentsOutputItems, parentNodes } = useUpstreamVariables({
    nodeId: id,
  })

  const inputItems = useMemo(() => {
    const inputsPayload = data.endpoint_channel.subscribe?.message.payload || {}
    return getCapabilityPayloadVariables(inputsPayload, data.capability)
  }, [data.capability, data.endpoint_channel.subscribe?.message.payload])

  const outputItems = useMemo(() => {
    const outputsPayload = data.endpoint_channel.publish?.message.payload || {}
    return getCapabilityPayloadVariables(outputsPayload, data.capability)
  }, [data.capability, data.endpoint_channel.publish?.message.payload])

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
            <IHubIconIntersect size={14} />
          </div>
          <div>
            <div style={{ fontWeight: 600 }}>{data.capability.name}</div>
            <div style={{ fontSize: 12, color: 'var(--mantine-color-dimmed)' }}>
              {data.endpoint}
            </div>
          </div>
        </span>
      }
      onDelete={onDelete}
      tags={[
        <Badge
          h={20}
          key={'capability-tag'}
          size='xs'
          me={'sm'}
          color={iconBackground}
        >
          Capability
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
      outputPositions={Position.Right}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <CapabilityNodeWidget
        nodeId={id}
        inputs={inputItems}
        outputs={outputItems}
        parentsOutputs={parentsOutputItems}
        parentNodes={parentNodes}
      />
    </BaseNode>
  )
}

/**
 * Displays the capability endpoint contract as input and output tabs.
 *
 * Inputs receive all available parent output variables so they can either map
 * to an upstream value or fall back to manual entry when no options exist.
 */
function CapabilityNodeWidget({
  nodeId,
  inputs,
  outputs,
  parentsOutputs,
  parentNodes,
}: {
  nodeId: string
  inputs: VariableItem[]
  outputs: VariableItem[]
  parentsOutputs: Record<string, VariableItem[]>
  parentNodes: Array<{
    id: string
    type?: string
    data?: Record<string, unknown>
  }>
}) {
  const { iconBackground } = nodeStyleMap['intersect'] || defaultNodeStyle
  const { provenanceKey, readOnly, canMutate } = useCampaignView()

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      <Tabs
        defaultValue='input'
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
        }}
      >
        <Tabs.List grow>
          <Tabs.Tab color={iconBackground} value='input'>
            Inputs
          </Tabs.Tab>
          <Tabs.Tab color={iconBackground} value='output'>
            Outputs
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value='input' style={{ flex: 1, minHeight: 0 }}>
          {inputs.length > 0 ? (
            <Stack my={'sm'} mr={'md'}>
              {inputs.map((input) => (
                <InputItem
                  nodeId={nodeId}
                  ioData={input}
                  parentsOutputItems={parentsOutputs}
                  parentNodes={parentNodes}
                  inputProvenanceKey={provenanceKey}
                  readOnly={readOnly}
                  canMutate={canMutate}
                  key={getCapabilityInputItemKey(
                    provenanceKey,
                    getVariableItemKey(input),
                  )}
                />
              ))}
            </Stack>
          ) : (
            <div>No inputs defined for this capability.</div>
          )}
        </Tabs.Panel>

        <Tabs.Panel value='output' style={{ flex: 1, minHeight: 0 }}>
          {outputs.length > 0 ? (
            <Stack my={'sm'} mr={'md'}>
              {outputs.map((output) => (
                <OutputItem ioData={output} key={getVariableItemKey(output)} />
              ))}
            </Stack>
          ) : (
            <div>No outputs defined for this capability.</div>
          )}
        </Tabs.Panel>
      </Tabs>
    </div>
  )
}

/**
 * Renders one capability input and keeps its value source synchronized with the
 * campaign graph.
 *
 * When parent outputs are available, the input can either edit edge
 * `data_mapping` entries or persist a debounced manual value on node data.
 */
function InputItem({
  nodeId,
  ioData,
  parentsOutputItems,
  parentNodes,
  inputProvenanceKey,
  readOnly,
  canMutate,
}: {
  nodeId: string
  ioData: VariableItem
  parentsOutputItems?: Record<string, VariableItem[]>
  parentNodes: Array<{
    id: string
    type?: string
    data?: Record<string, unknown>
  }>
  inputProvenanceKey: string
  readOnly: boolean
  canMutate: (scheduledProvenanceKey?: string) => boolean
}) {
  const inputTitle = ioData.title || ioData.path
  const sourceControlLabel = `Input source for ${inputTitle}`
  const upstreamValueLabel = `Upstream value for ${inputTitle}`
  const customValueLabel = `Custom value for ${inputTitle}`
  const {
    potentialOptions,
    hasUpstreamOptions,
    inputSource,
    selectedValue,
    manualValue,
    handleSourceChange,
    handleUpstreamValueChange,
    handleManualValueChange,
    flushManualValue,
  } = useCapabilityInputMapping({
    nodeId,
    input: ioData,
    parentsOutputItems,
    parentNodes,
    provenanceKey: inputProvenanceKey,
    readOnly,
    canMutate,
  })

  return (
    <Stack gap={3}>
      <VariableSummary ioData={ioData} />

      {hasUpstreamOptions ? (
        <Stack gap={4}>
          <InputSourceSegmentedControl
            ariaLabel={sourceControlLabel}
            value={inputSource}
            options={[
              { label: 'Upstream', value: 'upstream', disabled: readOnly },
              { label: 'Custom', value: 'custom', disabled: readOnly },
            ]}
            onChange={handleSourceChange}
          />
          {inputSource === 'upstream' ? (
            <Select
              size='xs'
              radius='xl'
              placeholder='Select value'
              data={potentialOptions}
              value={selectedValue}
              clearable
              aria-label={upstreamValueLabel}
              disabled={readOnly}
              onChange={handleUpstreamValueChange}
            />
          ) : (
            <ManualValueInput
              ioData={ioData}
              aria-label={customValueLabel}
              disabled={readOnly}
              value={manualValue}
              onChange={handleManualValueChange}
              onCommit={flushManualValue}
            />
          )}
        </Stack>
      ) : (
        <ManualValueInput
          ioData={ioData}
          aria-label={customValueLabel}
          disabled={readOnly}
          value={manualValue}
          onChange={handleManualValueChange}
          onCommit={flushManualValue}
        />
      )}
    </Stack>
  )
}

/**
 * Renders one capability output declared by the endpoint schema.
 */
function OutputItem({ ioData }: { ioData: VariableItem }) {
  return (
    <Stack gap={3}>
      <VariableSummary ioData={ioData} />
    </Stack>
  )
}

function VariableSummary({ ioData }: { ioData: VariableItem }) {
  return (
    <>
      <Group gap={6} justify='space-between'>
        <Text size='sm' fw={500}>
          {ioData.title}
        </Text>
        <Text size='xs' c='dimmed'>
          {ioData.type}
        </Text>
      </Group>

      {ioData.description && (
        <Text size='xs' c='dimmed' lineClamp={2}>
          {ioData.description}
        </Text>
      )}
    </>
  )
}

function ManualValueInput({
  ioData,
  value,
  onChange,
  onCommit,
  disabled,
  'aria-label': ariaLabel,
}: {
  ioData: VariableItem
  value: string
  onChange: (value: string) => void
  onCommit: () => void
  disabled: boolean
  'aria-label': string
}) {
  return (
    <Input
      size='xs'
      radius='xl'
      placeholder={
        ioData.default != null ? String(ioData.default) : 'Enter value'
      }
      aria-label={ariaLabel}
      disabled={disabled}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
      onBlur={onCommit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onCommit()
      }}
    />
  )
}

function getVariableItemKey(item: VariableItem): string {
  return item.path || `${item.path}-${item.title ?? item.type}`
}
