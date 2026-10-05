import {
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Modal,
  Stack,
  Text,
} from '@mantine/core'
import { Position } from '@xyflow/react'
import type {
  CampaignNode,
  JsonFileNode as JsonFileNodeData,
  JsonFileReference,
} from '@ihub/utils/types/campaign'
import type { JupyterServerConfig } from '@ihub/utils/types/notebook'
import type { ContentFile, ContentResponse } from '@ihub/utils/types/types'
import { useEffect, useMemo, useState } from 'react'

import { useCampaignActions } from '../../state/campaignContext'
import { useCampaignView } from '../../state/campaignViewContext'
import BaseNode from '../common/BaseNode'
import { defaultNodeStyle, nodeStyleMap } from '../common/nodeStyles'
import {
  buildJsonFileManifest,
  filterJsonPickerEntries,
  findJsonFileServer,
  loadJsonProjectFile,
} from './jsonFile'
import { IHubIconBraces } from '@ihub/utils/icons'

type JsonFileNodeProps = {
  id: string
  data: JsonFileNodeData
  projectId?: string
  jupyterServers?: JupyterServerConfig[]
  onDelete: () => void
}

const EMPTY_JUPYTER_SERVERS: JupyterServerConfig[] = []

type PickerProps = {
  opened: boolean
  onClose: () => void
  projectId?: string
  servers: JupyterServerConfig[]
  onSelect: (reference: JsonFileReference) => Promise<void>
  selectionError?: string | null
  isSelecting?: boolean
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

function JsonProjectFilePicker({
  opened,
  onClose,
  projectId,
  servers,
  onSelect,
  selectionError,
  isSelecting = false,
}: PickerProps) {
  const server = servers[0]
  const rootPath = projectId ? `projects/${projectId}` : ''
  const [currentPath, setCurrentPath] = useState(rootPath)
  const [entries, setEntries] = useState<ContentFile[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setCurrentPath(rootPath)
  }, [rootPath])

  useEffect(() => {
    if (!opened || !server || !currentPath) return

    const abortController = new AbortController()
    let isCurrentRequest = true
    setIsLoading(true)
    setError(null)
    fetch(`${server.url}/api/contents/${encodePath(currentPath)}`, {
      headers: {
        Authorization: `Bearer ${server.token}`,
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
      signal: abortController.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error('Unable to load Project Files.')
        }
        return (await response.json()) as ContentResponse
      })
      .then((response) => {
        if (!isCurrentRequest) return
        setEntries(
          filterJsonPickerEntries(response.content ?? []).sort((left, right) =>
            left.path.localeCompare(right.path),
          ),
        )
      })
      .catch((cause: unknown) => {
        if (
          isCurrentRequest &&
          (cause as { name?: string })?.name !== 'AbortError'
        ) {
          setError(
            cause instanceof Error
              ? cause.message
              : 'Unable to load Project Files.',
          )
        }
      })
      .finally(() => {
        if (isCurrentRequest) setIsLoading(false)
      })

    return () => {
      isCurrentRequest = false
      abortController.abort()
    }
  }, [currentPath, opened, server])

  const relativeDirectory = currentPath.startsWith(`${rootPath}/`)
    ? currentPath.slice(rootPath.length + 1)
    : ''

  return (
    <Modal opened={opened} onClose={onClose} title='Select a project JSON file'>
      <Stack gap='xs'>
        {!projectId ? (
          <Alert color='red'>No current project is available.</Alert>
        ) : !server ? (
          <Alert color='red'>No Jupyter file server is connected.</Alert>
        ) : (
          <>
            <Group justify='space-between'>
              <Text size='xs' c='dimmed'>
                /{relativeDirectory}
              </Text>
              <Button
                size='compact-xs'
                variant='subtle'
                disabled={currentPath === rootPath}
                onClick={() =>
                  setCurrentPath(currentPath.split('/').slice(0, -1).join('/'))
                }
              >
                Up
              </Button>
            </Group>
            {error && <Alert color='red'>{error}</Alert>}
            {selectionError && <Alert color='red'>{selectionError}</Alert>}
            {isLoading ? (
              <Group justify='center'>
                <Loader size='sm' />
              </Group>
            ) : entries.length === 0 ? (
              <Text size='sm' c='dimmed'>
                No folders or JSON files are available here.
              </Text>
            ) : (
              entries.map((entry) => (
                <Button
                  key={entry.path}
                  variant='subtle'
                  justify='flex-start'
                  disabled={isSelecting}
                  onClick={() => {
                    if (entry.type === 'directory') {
                      setCurrentPath(entry.path)
                      return
                    }
                    const relativePath = entry.path.slice(rootPath.length + 1)
                    void onSelect({
                      projectId,
                      path: relativePath,
                      jupyterServerId: server.id,
                    })
                  }}
                >
                  {entry.type === 'directory' ? '▸ ' : ''}
                  {entry.name}
                </Button>
              ))
            )}
          </>
        )}
      </Stack>
    </Modal>
  )
}

/** Renders a source-only node whose outputs come from a live project JSON file. */
export default function JsonFileNode({
  id,
  data,
  projectId,
  jupyterServers = EMPTY_JUPYTER_SERVERS,
  onDelete,
}: JsonFileNodeProps) {
  const { updateNodeData } = useCampaignActions()
  const { provenanceKey, readOnly, canMutate } = useCampaignView()
  const { background, border, iconBackground } =
    nodeStyleMap.json || defaultNodeStyle
  const [pickerOpened, setPickerOpened] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isManifestStale, setIsManifestStale] = useState(false)

  useEffect(() => {
    setPickerOpened(false)
    setIsRefreshing(false)
    setError(null)
    setIsManifestStale(false)
  }, [provenanceKey])

  const unsupportedFields = useMemo(
    () => data.manifest.filter((field) => field.type === null),
    [data.manifest],
  )

  useEffect(() => {
    const reference = data.fileReference
    if (!reference) {
      setIsManifestStale(false)
      return
    }
    if (!findJsonFileServer(reference, jupyterServers)) {
      setError('the configured Jupyter server is unavailable')
      setIsManifestStale(false)
      return
    }

    let isCurrentCheck = true
    loadJsonProjectFile(reference, jupyterServers)
      .then((loadedFile) => {
        if (!isCurrentCheck) return
        setError(null)
        setIsManifestStale(
          Boolean(
            data.contentHash && loadedFile.contentHash !== data.contentHash,
          ),
        )
      })
      .catch((cause: unknown) => {
        if (!isCurrentCheck) return
        setError(
          cause instanceof Error
            ? cause.message
            : 'Unable to read the selected JSON file.',
        )
        setIsManifestStale(false)
      })

    return () => {
      isCurrentCheck = false
    }
  }, [data.contentHash, data.fileReference, jupyterServers, provenanceKey])

  const refreshReference = async (reference: JsonFileReference) => {
    const originatingProvenanceKey = provenanceKey
    if (!canMutate(originatingProvenanceKey)) return
    setIsRefreshing(true)
    setError(null)
    try {
      const loadedFile = await loadJsonProjectFile(reference, jupyterServers)
      if (!canMutate(originatingProvenanceKey)) return
      updateNodeData(id, {
        ...data,
        name: reference.path.split('/').at(-1) ?? 'JSON File',
        fileReference: reference,
        manifest: buildJsonFileManifest(loadedFile.value),
        contentHash: loadedFile.contentHash,
      } as CampaignNode['data'])
      setIsManifestStale(false)
      setPickerOpened(false)
    } catch (cause) {
      if (!canMutate(originatingProvenanceKey)) return
      setError(
        cause instanceof Error
          ? cause.message
          : 'Unable to read the selected JSON file.',
      )
    } finally {
      if (canMutate(originatingProvenanceKey)) setIsRefreshing(false)
    }
  }

  const selectedPath = data.fileReference?.path

  return (
    <>
      <BaseNode
        id={id}
        title={
          <span
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
          >
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
                {data.name || 'JSON File'}
              </span>
            </span>
          </span>
        }
        onDelete={onDelete}
        tags={[
          <Badge
            h={20}
            key='json-file-tag'
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
            {selectedPath ?? 'No file selected'}
          </Text>
          {isManifestStale && (
            <Alert color='yellow'>
              This file changed after its field manifest was generated. Refresh
              fields to update the selectable outputs.
            </Alert>
          )}
          <Group grow>
            <Button
              size='xs'
              color={iconBackground}
              disabled={readOnly}
              onClick={() => {
                if (canMutate(provenanceKey)) setPickerOpened(true)
              }}
            >
              {selectedPath ? 'Select another file' : 'Select file'}
            </Button>
            <Button
              size='xs'
              variant='light'
              loading={isRefreshing}
              disabled={readOnly || !data.fileReference}
              onClick={() => {
                if (data.fileReference) {
                  void refreshReference(data.fileReference)
                }
              }}
            >
              Refresh fields
            </Button>
          </Group>
          {data.manifest.length > 0 && (
            <Stack gap={4}>
              {data.manifest.map((field) => (
                <Group
                  key={field.pointer}
                  justify='space-between'
                  wrap='nowrap'
                >
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
      <JsonProjectFilePicker
        opened={!readOnly && pickerOpened}
        onClose={() => setPickerOpened(false)}
        projectId={projectId}
        servers={jupyterServers}
        onSelect={refreshReference}
        selectionError={error}
        isSelecting={isRefreshing}
      />
    </>
  )
}
