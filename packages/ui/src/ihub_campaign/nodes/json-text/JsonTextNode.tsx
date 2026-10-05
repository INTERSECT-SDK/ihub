import { Alert, Badge, Group, Stack, Text, Textarea } from '@mantine/core'
import { Position } from '@xyflow/react'
import type {
  CampaignNode,
  JsonFileField,
  JsonTextNode as JsonTextNodeData,
} from '@ihub/utils/types/campaign'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useCampaignActions } from '../../state/campaignContext'
import { useCampaignView } from '../../state/campaignViewContext'
import BaseNode from '../common/BaseNode'
import { defaultNodeStyle, nodeStyleMap } from '../common/nodeStyles'
import { buildJsonFileManifest } from '../json-file/jsonFile'
import { IHubIconBraces } from '@ihub/utils/icons'

type JsonTextNodeProps = {
  id: string
  data: JsonTextNodeData
  onDelete: () => void
}

// Matches the manual-input debounce used elsewhere so typing doesn't thrash
// the campaign graph sync effects on every keystroke.
const JSON_TEXT_SAVE_DELAY_MS = 250

/** Renders a source-only node whose outputs come from typed JSON text. */
export default function JsonTextNode({
  id,
  data,
  onDelete,
}: JsonTextNodeProps) {
  const { updateNodeData } = useCampaignActions()
  const { provenanceKey, readOnly, canMutate } = useCampaignView()
  const { background, border, iconBackground } =
    nodeStyleMap.json || defaultNodeStyle
  const [textValue, setTextValue] = useState(data.textContent ?? '')
  const localProvenanceRef = useRef(provenanceKey)

  useEffect(() => {
    localProvenanceRef.current = provenanceKey
    setTextValue(data.textContent ?? '')
  }, [data.textContent, provenanceKey])

  const localStateBelongsToView = localProvenanceRef.current === provenanceKey
  const displayedTextValue =
    readOnly || !localStateBelongsToView ? (data.textContent ?? '') : textValue

  const { manifest: localManifest, error } = useMemo((): {
    manifest: JsonFileField[]
    error: string | null
  } => {
    if (!displayedTextValue.trim()) {
      return { manifest: [], error: null }
    }
    try {
      return {
        manifest: buildJsonFileManifest(JSON.parse(displayedTextValue)),
        error: null,
      }
    } catch {
      return { manifest: [], error: 'the entered text is not valid JSON' }
    }
  }, [displayedTextValue])

  const unsupportedFields = useMemo(
    () => localManifest.filter((field) => field.type === null),
    [localManifest],
  )

  const commitTextValue = useCallback(() => {
    if (!localStateBelongsToView || !canMutate(provenanceKey)) return
    if (textValue === (data.textContent ?? '')) return
    updateNodeData(id, {
      ...data,
      textContent: textValue,
      manifest: localManifest,
    } as CampaignNode['data'])
  }, [
    canMutate,
    data,
    id,
    localManifest,
    localStateBelongsToView,
    provenanceKey,
    textValue,
    updateNodeData,
  ])

  // Commit the parsed manifest and text to the campaign graph after typing
  // settles, instead of dispatching on every keystroke.
  useEffect(() => {
    if (!localStateBelongsToView) return
    if (!canMutate(provenanceKey)) return
    if (textValue === (data.textContent ?? '')) {
      return
    }

    const timeout = window.setTimeout(commitTextValue, JSON_TEXT_SAVE_DELAY_MS)

    return () => window.clearTimeout(timeout)
  }, [
    canMutate,
    commitTextValue,
    data.textContent,
    localStateBelongsToView,
    provenanceKey,
    textValue,
  ])

  return (
    <BaseNode
      id={id}
      title={
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span
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
            <IHubIconBraces size={14} />
          </span>
          <span>
            <span style={{ display: 'block', fontWeight: 600 }}>
              {data.name}
            </span>
          </span>
        </span>
      }
      onDelete={onDelete}
      tags={[
        <Badge
          h={20}
          key='json-text-tag'
          size='xs'
          me='sm'
          color={iconBackground}
        >
          Input
        </Badge>,
      ]}
      style={{ background, border }}
      hasInputs={false}
      hasOutputs
      outputPositions={Position.Right}
      handleColor={iconBackground}
    >
      <Stack gap='xs'>
        {error && <Alert color='red'>{error}</Alert>}
        <Text size='xs' c='dimmed'>
          {`${localManifest.length} field${localManifest.length === 1 ? '' : 's'}`}
        </Text>
        <Textarea
          autosize
          minRows={4}
          maxRows={12}
          placeholder='{"key": "value"}'
          value={displayedTextValue}
          disabled={readOnly}
          onChange={(event) => {
            if (canMutate(provenanceKey)) {
              setTextValue(event.currentTarget.value)
            }
          }}
          onBlur={commitTextValue}
        />
        {localManifest.length > 0 && (
          <Stack gap={4}>
            {localManifest.map((field) => (
              <Group key={field.pointer} justify='space-between' wrap='nowrap'>
                <Text size='xs' truncate title={field.pointer || '/'}>
                  {field.displayName}
                </Text>
                <Text size='xs' c={field.type ? 'dimmed' : 'red'}>
                  {field.type ?? 'unresolved'}
                </Text>
              </Group>
            ))}
          </Stack>
        )}
        {unsupportedFields.length > 0 && (
          <Text size='xs' c='orange'>
            {unsupportedFields.length} field
            {unsupportedFields.length === 1 ? '' : 's'} cannot be mapped.
          </Text>
        )}
      </Stack>
    </BaseNode>
  )
}
