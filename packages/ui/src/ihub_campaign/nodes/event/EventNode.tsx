import {
  Badge,
  Button,
  Center,
  Group,
  Loader,
  NumberInput,
  Select,
  Stack,
  Tabs,
  Text,
  Tooltip,
} from '@mantine/core'
import { IHubIconInfoCircle, IHubIconIntersect } from '@ihub/utils/icons'
import { formatLocalDateTime } from '@ihub/utils/helpers/date-time'
import { getVariablesFromNode } from '@ihub/utils/helpers/helpers'
import type {
  CampaignEventMode,
  EventNode as EventNodeData,
} from '@ihub/utils/types/campaign'
import { Position } from '@xyflow/react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import {
  buildEventLogSignalKey,
  EVENT_LOG_PAGE_SIZE,
  fetchEventLogs,
  formatEventPayload,
  mergeEventLogPages,
  type CampaignEventLog,
} from '../../execution/eventLogs'
import { useCampaignNodeRenderSettings } from '../../editor/CampaignNodeRenderContext'
import { useCampaignActions } from '../../state/campaignContext'
import { useCampaignEventLog } from '../../state/eventLogContext'
import { useCampaignView } from '../../state/campaignViewContext'
import BaseNode from '../common/BaseNode'
import { defaultNodeStyle, nodeStyleMap } from '../common/nodeStyles'
import {
  getCapabilityEventSchemaDocument,
  normalizeEventPayloadSchema,
  normalizeEventSettings,
} from './eventSchema'
import { EVENT_MODE_LABELS, EVENT_MODE_TOOLTIPS } from './eventModeTooltips'

/** Renders an INTERSECT event listener with payload outputs and completion controls. */
export default function EventNode({
  id,
  data,
  onDelete,
}: {
  id: string
  data: EventNodeData
  onDelete: () => void
}) {
  const { updateNodeData } = useCampaignActions()
  const renderSettings = useCampaignNodeRenderSettings()
  const { provenanceKey, readOnly, canMutate } = useCampaignView()
  const { background, border, iconBackground } =
    nodeStyleMap.intersect || defaultNodeStyle
  const outputs = useMemo(
    () =>
      getVariablesFromNode(
        normalizeEventPayloadSchema(
          data.event_schema,
          getCapabilityEventSchemaDocument(data.capability),
        ),
      ),
    [data.capability, data.event_schema],
  )
  const [activeTab, setActiveTab] = useState<string | null>('input')

  const updateSettings = (
    eventMode: CampaignEventMode,
    eventCount: number | null | undefined,
  ) => {
    if (!canMutate(provenanceKey)) return
    updateNodeData(id, {
      ...data,
      ...normalizeEventSettings(eventMode, eventCount),
    })
  }

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
            }}
          >
            <IHubIconIntersect size={14} />
          </span>
          <span>
            <span style={{ display: 'block', fontWeight: 600 }}>
              {data.capability.name}
            </span>
            <span
              style={{ fontSize: 12, color: 'var(--mantine-color-dimmed)' }}
            >
              {data.event_name}
            </span>
          </span>
        </span>
      }
      onDelete={onDelete}
      tags={[
        <Badge h={20} key='event-tag' size='xs' me='sm' color={iconBackground}>
          Event
        </Badge>,
      ]}
      style={{ background, border }}
      handleColor={iconBackground}
      outputPositions={Position.Right}
    >
      <Tabs
        value={activeTab}
        onChange={setActiveTab}
        style={
          renderSettings.mode === 'inspector'
            ? {
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                minHeight: 0,
              }
            : undefined
        }
      >
        <Tabs.List grow style={{ flexShrink: 0 }}>
          <Tabs.Tab color={iconBackground} value='input'>
            Input
          </Tabs.Tab>
          <Tabs.Tab color={iconBackground} value='logs'>
            Logs
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value='input'>
          <Stack gap='xs' my='sm'>
            <Select
              label={
                <Group gap={4} wrap='nowrap'>
                  <span>Mode</span>
                  <Tooltip
                    label={EVENT_MODE_TOOLTIPS[data.event_mode]}
                    events={{ hover: true, focus: true, touch: false }}
                    multiline
                    w={260}
                  >
                    <span
                      role='img'
                      tabIndex={0}
                      aria-label={`About ${EVENT_MODE_LABELS[data.event_mode]} event mode`}
                      style={{
                        alignItems: 'center',
                        background: 'transparent',
                        border: 0,
                        color: 'var(--mantine-color-dimmed)',
                        cursor: 'help',
                        display: 'inline-flex',
                        padding: 0,
                      }}
                    >
                      <IHubIconInfoCircle aria-hidden size={14} />
                    </span>
                  </Tooltip>
                </Group>
              }
              size='xs'
              data={[
                { label: 'Once', value: 'once' },
                { label: 'Count', value: 'count' },
                { label: 'Persistent', value: 'persistent' },
              ]}
              value={data.event_mode}
              disabled={readOnly}
              onChange={(value) =>
                updateSettings(
                  (value as CampaignEventMode | null) ?? 'once',
                  data.event_count,
                )
              }
            />
            {data.event_mode === 'count' && (
              <NumberInput
                label='Event count'
                size='xs'
                min={1}
                step={1}
                allowDecimal={false}
                value={data.event_count ?? 1}
                disabled={readOnly}
                onChange={(value) =>
                  updateSettings(
                    'count',
                    typeof value === 'number' ? value : Number(value),
                  )
                }
              />
            )}
            <Text size='xs' fw={600}>
              Payload outputs
            </Text>
            {outputs.length ? (
              outputs.map((output) => (
                <Text key={output.path} size='xs'>
                  {output.title || output.path} ({output.type})
                </Text>
              ))
            ) : (
              <Text size='xs' c='dimmed'>
                No payload fields defined.
              </Text>
            )}
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel
          value='logs'
          style={
            renderSettings.mode === 'inspector'
              ? { flex: 1, minHeight: 0, overflow: 'hidden' }
              : undefined
          }
        >
          {activeTab === 'logs' && (
            <EventLogs
              nodeId={id}
              fillAvailableHeight={renderSettings.mode === 'inspector'}
            />
          )}
        </Tabs.Panel>
      </Tabs>
    </BaseNode>
  )
}

/** Fetches and displays persisted events only while the Logs tab is mounted. */
function EventLogs({
  nodeId,
  fillAvailableHeight,
}: {
  nodeId: string
  fillAvailableHeight: boolean
}) {
  const { runId, runIsLoading, runError, retryRunLookup, refreshSignals } =
    useCampaignEventLog()
  const [logs, setLogs] = useState<CampaignEventLog[] | null>(null)
  const [initialError, setInitialError] = useState<string | null>(null)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [olderError, setOlderError] = useState<string | null>(null)
  const [hasOlder, setHasOlder] = useState(false)
  const [isLoadingOlder, setIsLoadingOlder] = useState(false)
  const [retryKey, setRetryKey] = useState(0)
  const viewportRef = useRef<HTMLDivElement>(null)
  const shouldFollowRef = useRef(true)
  const logsRef = useRef<CampaignEventLog[] | null>(null)
  const sourceAbortRef = useRef<AbortController | null>(null)
  const refreshInFlightSourceRef = useRef<AbortController | null>(null)
  const refreshPendingRef = useRef(false)
  const olderInFlightSourceRef = useRef<AbortController | null>(null)
  const prependScrollRef = useRef<{
    scrollHeight: number
    scrollTop: number
  } | null>(null)
  const signalKey = runId ? buildEventLogSignalKey(runId, nodeId) : null
  const latestPersistedEventId = signalKey
    ? (refreshSignals[signalKey] ?? null)
    : null
  const refreshTargetRef = useRef<number | null>(latestPersistedEventId)
  refreshTargetRef.current = latestPersistedEventId
  const viewportHeight = fillAvailableHeight ? '100%' : 220

  /** Appends all pages required to reach the newest persisted relay signal. */
  const loadNewer = useCallback(
    async function loadNewerPages(): Promise<void> {
      const controller = sourceAbortRef.current
      if (
        !runId ||
        !controller ||
        controller.signal.aborted ||
        refreshInFlightSourceRef.current === controller ||
        logsRef.current === null
      ) {
        return
      }

      refreshInFlightSourceRef.current = controller
      setRefreshError(null)
      try {
        while (!controller.signal.aborted) {
          refreshPendingRef.current = false
          const currentLogs = logsRef.current ?? []
          const newestId = currentLogs[currentLogs.length - 1]?.id
          const targetId = refreshTargetRef.current
          if (!targetId || (newestId && newestId >= targetId)) return

          const page = await fetchEventLogs(
            runId,
            nodeId,
            newestId ? { afterId: newestId } : {},
            controller.signal,
          )
          if (controller.signal.aborted || page.length === 0) return

          const merged = mergeEventLogPages(
            logsRef.current ?? currentLogs,
            page,
          )
          logsRef.current = merged
          setLogs(merged)
          if (
            page.length < EVENT_LOG_PAGE_SIZE &&
            (merged[merged.length - 1]?.id ?? 0) <
              (refreshTargetRef.current ?? 0)
          ) {
            return
          }
        }
      } catch (fetchError) {
        if (!controller.signal.aborted) {
          setRefreshError(
            fetchError instanceof Error
              ? fetchError.message
              : 'Could not refresh event logs.',
          )
        }
      } finally {
        if (refreshInFlightSourceRef.current === controller) {
          refreshInFlightSourceRef.current = null
          if (refreshPendingRef.current && !controller.signal.aborted) {
            queueMicrotask(() => void loadNewerPages())
          }
        }
      }
    },
    [nodeId, runId],
  )

  /**
   * Loads the newest bounded page and cancels work only when its source changes.
   */
  useEffect(() => {
    sourceAbortRef.current?.abort()
    const controller = new AbortController()
    sourceAbortRef.current = controller
    logsRef.current = null
    setLogs(null)
    setInitialError(null)
    setRefreshError(null)
    setOlderError(null)
    setHasOlder(false)
    setIsLoadingOlder(false)
    refreshPendingRef.current = false
    refreshInFlightSourceRef.current = null
    olderInFlightSourceRef.current = null
    shouldFollowRef.current = true
    if (!runId) return () => controller.abort()

    void fetchEventLogs(runId, nodeId, {}, controller.signal)
      .then((events) => {
        if (controller.signal.aborted) return
        logsRef.current = events
        setLogs(events)
        setHasOlder(events.length === EVENT_LOG_PAGE_SIZE)
        refreshPendingRef.current = true
        void loadNewer()
      })
      .catch((fetchError) => {
        if (!controller.signal.aborted) {
          setInitialError(
            fetchError instanceof Error
              ? fetchError.message
              : 'Could not load event logs.',
          )
        }
      })
    return () => controller.abort()
  }, [loadNewer, nodeId, retryKey, runId])

  /** Coalesces relay notifications while an incremental request is active. */
  useEffect(() => {
    if (!latestPersistedEventId || logsRef.current === null) return
    refreshPendingRef.current = true
    void loadNewer()
  }, [latestPersistedEventId, loadNewer])

  /** Prepends the next older page without replacing already displayed rows. */
  const loadOlder = useCallback(async () => {
    const controller = sourceAbortRef.current
    const currentLogs = logsRef.current
    const oldestId = currentLogs?.[0]?.id
    if (
      !runId ||
      !controller ||
      controller.signal.aborted ||
      !currentLogs ||
      !oldestId ||
      olderInFlightSourceRef.current === controller
    ) {
      return
    }

    const viewport = viewportRef.current
    if (viewport) {
      prependScrollRef.current = {
        scrollHeight: viewport.scrollHeight,
        scrollTop: viewport.scrollTop,
      }
    }
    olderInFlightSourceRef.current = controller
    setIsLoadingOlder(true)
    setOlderError(null)
    try {
      const page = await fetchEventLogs(
        runId,
        nodeId,
        { beforeId: oldestId },
        controller.signal,
      )
      if (controller.signal.aborted) return
      const merged = mergeEventLogPages(logsRef.current ?? currentLogs, page)
      logsRef.current = merged
      setLogs(merged)
      setHasOlder(page.length === EVENT_LOG_PAGE_SIZE)
    } catch (fetchError) {
      prependScrollRef.current = null
      if (!controller.signal.aborted) {
        setOlderError(
          fetchError instanceof Error
            ? fetchError.message
            : 'Could not load earlier event logs.',
        )
      }
    } finally {
      if (olderInFlightSourceRef.current === controller) {
        olderInFlightSourceRef.current = null
      }
      if (!controller.signal.aborted) setIsLoadingOlder(false)
    }
  }, [nodeId, runId])

  /**
   * Preserves an older-page scroll anchor or follows newly appended events.
   */
  useLayoutEffect(() => {
    const viewport = viewportRef.current
    const prependScroll = prependScrollRef.current
    if (viewport && prependScroll) {
      viewport.scrollTop =
        prependScroll.scrollTop +
        viewport.scrollHeight -
        prependScroll.scrollHeight
      prependScrollRef.current = null
      return
    }
    if (viewport && shouldFollowRef.current) {
      viewport.scrollTop = viewport.scrollHeight
    }
  }, [logs])

  if (runIsLoading && !runId) {
    return (
      <Center h={viewportHeight}>
        <Loader size='sm' aria-label='Loading campaign run' />
      </Center>
    )
  }

  if (runError && !runId) {
    return (
      <Center h={viewportHeight}>
        <Stack gap='xs' align='center'>
          <Text size='xs' c='red' ta='center'>
            {runError}
          </Text>
          <Button size='compact-xs' variant='light' onClick={retryRunLookup}>
            Retry
          </Button>
        </Stack>
      </Center>
    )
  }

  if (!runId) {
    return (
      <Center h={viewportHeight}>
        <Text size='xs' c='dimmed' ta='center'>
          No campaign run is available for these logs.
        </Text>
      </Center>
    )
  }

  if (initialError && logs === null) {
    return (
      <Center h={viewportHeight}>
        <Stack gap='xs' align='center'>
          <Text size='xs' c='red' ta='center'>
            {initialError}
          </Text>
          <Button
            size='compact-xs'
            variant='light'
            onClick={() => setRetryKey((key) => key + 1)}
          >
            Retry
          </Button>
        </Stack>
      </Center>
    )
  }

  if (logs === null) {
    return (
      <Center h={viewportHeight}>
        <Loader size='sm' aria-label='Loading event logs' />
      </Center>
    )
  }

  if (logs.length === 0 && !refreshError) {
    return (
      <Center h={viewportHeight}>
        <Text size='xs' c='dimmed'>
          No events have been recorded for this node.
        </Text>
      </Center>
    )
  }

  return (
    <div
      ref={viewportRef}
      aria-label='Event logs'
      style={{ height: viewportHeight, overflowY: 'auto' }}
      onScroll={(event) => {
        const viewport = event.currentTarget
        shouldFollowRef.current =
          viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <
          16
      }}
    >
      <Stack gap='xs' py='xs'>
        {hasOlder && (
          <Button
            size='compact-xs'
            variant='subtle'
            loading={isLoadingOlder}
            onClick={() => void loadOlder()}
          >
            Load earlier events
          </Button>
        )}
        {refreshError && (
          <Group gap='xs' justify='center'>
            <Text size='xs' c='red'>
              {refreshError}
            </Text>
            <Button
              size='compact-xs'
              variant='light'
              onClick={() => {
                refreshPendingRef.current = true
                void loadNewer()
              }}
            >
              Retry
            </Button>
          </Group>
        )}
        {olderError && (
          <Group gap='xs' justify='center'>
            <Text size='xs' c='red'>
              {olderError}
            </Text>
            <Button
              size='compact-xs'
              variant='light'
              onClick={() => void loadOlder()}
            >
              Retry
            </Button>
          </Group>
        )}
        {logs.map((log) => {
          const payload = formatEventPayload(log.payload)
          return (
            <div key={log.id}>
              <Text
                component='time'
                dateTime={log.created_at}
                title={log.created_at}
                size='xs'
                c='dimmed'
              >
                {formatLocalTimestamp(log.created_at)}
              </Text>
              {payload === null ? (
                <Text size='xs' c='dimmed'>
                  Event payload is unavailable.
                </Text>
              ) : (
                <Text
                  component='pre'
                  size='xs'
                  style={{
                    margin: 0,
                    whiteSpace: 'pre-wrap',
                    overflowWrap: 'anywhere',
                  }}
                >
                  {payload}
                </Text>
              )}
            </div>
          )
        })}
      </Stack>
    </div>
  )
}

function formatLocalTimestamp(timestamp: string): string {
  return formatLocalDateTime(timestamp) ?? timestamp
}
