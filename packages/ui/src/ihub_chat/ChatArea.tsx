'use client'

import {
  ActionIcon,
  Alert,
  Avatar,
  Badge,
  Box,
  Button,
  Code,
  Group,
  Image,
  Paper,
  Progress,
  Stack,
  Text,
  TextInput,
  Tooltip,
  Typography,
  useMantineColorScheme,
} from '@mantine/core'
import {
  ChatContentBlock,
  ChatMessage,
  ChatParticipant,
} from '@ihub/utils/types/chat'
import { downloadJson } from '@ihub/utils/helpers/download'
import {
  formatLocalDateTime,
  formatLocalTime,
  parseApiDateTime,
} from '@ihub/utils/helpers/date-time'
import { IHubIconDownload, IHubIconFile } from '@ihub/utils/icons'
import {
  CSSProperties,
  ComponentType,
  ReactNode,
  cloneElement,
  isValidElement,
} from 'react'

import dynamic from 'next/dynamic'
import chatClasses from './Chat.module.css'
import { normalizeAsciiTables } from './chat-markdown'

/* CommonJS */
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useEffect, useState } from 'react'
import { VegaEmbed } from 'react-vega'
import { UserProfile } from '@ihub/utils/types/types'

type PlotComponentProps = {
  data?: Plotly.Data[]
  layout?: Partial<Plotly.Layout>
  config?: Partial<Plotly.Config>
  style?: CSSProperties
}

const Plot = dynamic<PlotComponentProps>(
  () =>
    import('react-plotly.js').then(
      (mod) => mod.default as unknown as ComponentType<PlotComponentProps>,
    ),
  { ssr: false },
)

interface ChatAreaProps {
  chatParticipants: ChatParticipant[]
  chatHistory: ChatMessage[]
  otherAgentTyping?: boolean
  currentUser: UserProfile
  onPromptResponse?: (
    promptId: string,
    response: string | boolean | string[],
  ) => void
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildMentionPattern(mentionNames: string[]): RegExp | null {
  const uniqueNames = Array.from(
    new Set(mentionNames.map((name) => name.trim()).filter(Boolean)),
  )

  if (uniqueNames.length === 0) {
    return null
  }

  const orderedNames = uniqueNames.sort((a, b) => b.length - a.length)
  const nameAlternation = orderedNames
    .map((name) => escapeRegExp(name))
    .join('|')

  return new RegExp(
    `(^|\\s)(@(?:${nameAlternation}))(?=$|\\s|[.,!?;:)\\]}])`,
    'gi',
  )
}

function splitMentionText(
  text: string,
  mentionNames: string[],
): Array<{ text: string; mention: boolean }> {
  const segments: Array<{ text: string; mention: boolean }> = []
  const mentionPattern = buildMentionPattern(mentionNames)
  if (!mentionPattern) {
    return [{ text, mention: false }]
  }

  let lastIndex = 0

  for (const match of text.matchAll(mentionPattern)) {
    const fullMatch = match[0]
    const mention = match[2]
    if (!fullMatch || !mention || match.index === undefined) {
      continue
    }

    const prefixLength = fullMatch.length - mention.length
    const mentionStart = match.index + prefixLength

    if (mentionStart > lastIndex) {
      segments.push({
        text: text.slice(lastIndex, mentionStart),
        mention: false,
      })
    }

    segments.push({ text: mention, mention: true })
    lastIndex = mentionStart + mention.length
  }

  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), mention: false })
  }

  if (segments.length === 0) {
    return [{ text, mention: false }]
  }

  return segments
}

function highlightMentionNode(
  node: ReactNode,
  tone: 'light' | 'dark',
  mentionNames: string[],
): ReactNode {
  if (typeof node === 'string') {
    const segments = splitMentionText(node, mentionNames)
    if (!segments.some((segment) => segment.mention)) {
      return node
    }

    return segments.map((segment, idx) => {
      if (!segment.mention) {
        return <span key={`text-${idx}`}>{segment.text}</span>
      }

      return (
        <span
          key={`mention-${idx}`}
          style={{
            display: 'inline-block',
            padding: '0 6px',
            borderRadius: 999,
            fontWeight: 700,
            fontFamily: 'var(--mantine-font-family-monospace)',
            background:
              tone === 'dark'
                ? 'rgba(59, 130, 246, 0.25)'
                : 'var(--mantine-color-blue-1)',
            color:
              tone === 'dark'
                ? 'var(--mantine-color-blue-2)'
                : 'var(--mantine-color-blue-9)',
          }}
        >
          {segment.text}
        </span>
      )
    })
  }

  if (Array.isArray(node)) {
    return node.map((child, idx) => (
      <span key={`mention-node-${idx}`}>
        {highlightMentionNode(child, tone, mentionNames)}
      </span>
    ))
  }

  if (!isValidElement<{ children?: ReactNode }>(node)) {
    return node
  }

  const elementType = typeof node.type === 'string' ? node.type : ''
  if (elementType === 'code' || elementType === 'pre') {
    return node
  }

  return cloneElement(node, {
    children: highlightMentionNode(node.props.children, tone, mentionNames),
  })
}

function normalizeMessageBlocks(message: ChatMessage): ChatContentBlock[] {
  if (Array.isArray(message.content)) {
    return message.content
  }

  return [
    {
      type: 'markdown',
      text: String(message.content || ''),
    },
  ]
}

function PromptBlock({
  block,
  onPromptResponse,
}: {
  block: Extract<ChatContentBlock, { type: 'prompt' }>
  onPromptResponse?: (
    promptId: string,
    response: string | boolean | string[],
  ) => void
}) {
  const [value, setValue] = useState('')

  if (block.inputType === 'confirm') {
    return (
      <Paper withBorder radius='md' p='sm'>
        <Stack gap='xs'>
          <Text fw={600}>{block.label}</Text>
          <Group>
            <Button
              size='xs'
              onClick={() => onPromptResponse?.(block.promptId, true)}
              disabled={block.submitted}
            >
              Confirm
            </Button>
            <Button
              size='xs'
              variant='light'
              color='gray'
              onClick={() => onPromptResponse?.(block.promptId, false)}
              disabled={block.submitted}
            >
              Cancel
            </Button>
          </Group>
        </Stack>
      </Paper>
    )
  }

  if (block.inputType === 'select' && block.options?.length) {
    return (
      <Paper withBorder radius='md' p='sm'>
        <Stack gap='xs'>
          <Text fw={600}>{block.label}</Text>
          <Group>
            {block.options.map((option) => (
              <Button
                key={option.value}
                size='xs'
                variant='light'
                onClick={() => onPromptResponse?.(block.promptId, option.value)}
                disabled={block.submitted}
              >
                {option.label}
              </Button>
            ))}
          </Group>
        </Stack>
      </Paper>
    )
  }

  return (
    <Paper withBorder radius='md' p='sm'>
      <Stack gap='xs'>
        <Text fw={600}>{block.label}</Text>
        <Group align='end'>
          <TextInput
            style={{ flex: 1 }}
            placeholder={block.placeholder || 'Type a response'}
            value={value}
            onChange={(event) => setValue(event.currentTarget.value)}
            disabled={block.submitted}
          />
          <Button
            size='xs'
            onClick={() => {
              if (!value.trim()) {
                return
              }
              onPromptResponse?.(block.promptId, value.trim())
              setValue('')
            }}
            disabled={block.submitted}
          >
            Submit
          </Button>
        </Group>
      </Stack>
    </Paper>
  )
}

function VisualizationBlock({
  block,
}: {
  block: Extract<ChatContentBlock, { type: 'visualization' }>
}) {
  if (block.format === 'vega-lite' || block.format === 'vega') {
    return (
      <VegaEmbed
        spec={block.spec as Record<string, unknown>}
        options={{ mode: block.format, actions: false }}
      />
    )
  }

  if (block.format === 'plotly') {
    const spec = (block.spec || {}) as {
      data?: Plotly.Data[]
      layout?: Partial<Plotly.Layout>
      config?: Partial<Plotly.Config>
    }

    return (
      <Plot
        data={spec.data || []}
        layout={
          spec.layout || {
            autosize: true,
            margin: { l: 24, r: 24, t: 32, b: 24 },
          }
        }
        config={spec.config || { responsive: true }}
        style={{ width: '100%', height: '100%' }}
      />
    )
  }

  return <Code block>{JSON.stringify(block.spec, null, 2)}</Code>
}

function ImageBlock({
  block,
}: {
  block: Extract<ChatContentBlock, { type: 'image' }>
}) {
  const sourceWidth =
    typeof block.width === 'number' &&
    Number.isFinite(block.width) &&
    block.width > 0
      ? block.width
      : null
  const renderedWidth = sourceWidth
    ? Math.min(sourceWidth * 2, 3200)
    : 'min(100%, 960px)'

  const downloadImage = () => {
    const extensionByMimeType: Record<typeof block.mimeType, string> = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/gif': 'gif',
      'image/webp': 'webp',
    }
    const safeName = (block.alt || 'tool-image')
      .trim()
      .replace(/[^a-z0-9_-]+/gi, '-')
      .replace(/^-+|-+$/g, '')
    const binary = atob(block.data)
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    const blob = new Blob([bytes], { type: block.mimeType })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')

    link.href = url
    link.download = `${safeName || 'tool-image'}.${extensionByMimeType[block.mimeType]}`
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  return (
    <div
      className={chatClasses.imageContainer}
      style={{ width: renderedWidth }}
    >
      <Image
        src={`data:${block.mimeType};base64,${block.data}`}
        alt={block.alt || 'Tool-generated image'}
        fit='contain'
        className={chatClasses.renderedImage}
      />
      <ActionIcon
        type='button'
        variant='default'
        size='md'
        aria-label='Download image'
        title='Download image'
        onClick={downloadImage}
        className={chatClasses.imageDownloadButton}
      >
        <IHubIconDownload size={16} stroke={1.8} />
      </ActionIcon>
    </div>
  )
}

function safeSerialize(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return '[unserializable tool output]'
  }
}

function formatDurationMs(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`
  }

  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)}s`
  }

  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1000)
  return `${minutes}m ${seconds}s`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ---------------------------------------------------------------------------
// Inline JSON tree viewer
// ---------------------------------------------------------------------------

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

function JsonLeaf({ value }: { value: JsonValue }) {
  if (value === null)
    return <span style={{ color: 'var(--mantine-color-gray-5)' }}>null</span>
  if (typeof value === 'boolean')
    return (
      <span style={{ color: 'var(--mantine-color-violet-6)' }}>
        {String(value)}
      </span>
    )
  if (typeof value === 'number')
    return <span style={{ color: 'var(--mantine-color-blue-5)' }}>{value}</span>
  // string
  return (
    <span style={{ color: 'var(--mantine-color-teal-6)' }}>
      &quot;{String(value)}&quot;
    </span>
  )
}

function JsonNode({
  keyName,
  value,
  depth,
  defaultCollapsed,
}: {
  keyName?: string
  value: JsonValue
  depth: number
  defaultCollapsed: boolean
}) {
  const isObject =
    value !== null && typeof value === 'object' && !Array.isArray(value)
  const isArray = Array.isArray(value)
  const isExpandable = isObject || isArray
  const [open, setOpen] = useState(!defaultCollapsed)

  const entries: [string, JsonValue][] = isArray
    ? (value as JsonValue[]).map((v, i) => [String(i), v])
    : isObject
      ? Object.entries(value as Record<string, JsonValue>)
      : []

  const bracket = isArray ? ['[', ']'] : ['{', '}']
  const preview = isArray
    ? `Array(${entries.length})`
    : `{${entries
        .slice(0, 3)
        .map(([k]) => k)
        .join(', ')}${entries.length > 3 ? ', …' : ''}}`

  const indent = depth * 12

  return (
    <div
      className={chatClasses.jsonNode}
      style={{ '--indent': `${indent}px` } as React.CSSProperties}
    >
      <span
        onClick={() => isExpandable && setOpen((o) => !o)}
        className={chatClasses.jsonNodeItem}
      >
        {isExpandable && (
          <span
            className={chatClasses.jsonNodeToggle}
            style={
              {
                '--rotate': open ? 'rotate(90deg)' : 'rotate(0deg)',
              } as React.CSSProperties
            }
          >
            ▶
          </span>
        )}
        {keyName !== undefined && (
          <span className={chatClasses.jsonNodeKey}>{keyName}: </span>
        )}
        {isExpandable && !open && (
          <span className={chatClasses.jsonNodeBracket}>
            {bracket[0]}
            <span className={chatClasses.jsonNodePreview}>{preview}</span>
            {bracket[1]}
          </span>
        )}
        {isExpandable && open && (
          <span className={chatClasses.jsonNodeBracket}>{bracket[0]}</span>
        )}
        {!isExpandable && <JsonLeaf value={value} />}
      </span>

      {isExpandable && open && (
        <>
          {entries.map(([k, v]) => (
            <JsonNode
              key={k}
              keyName={isArray ? undefined : k}
              value={v}
              depth={depth + 1}
              defaultCollapsed={depth >= 1}
            />
          ))}
          <span className={chatClasses.jsonNodeBracket}>{bracket[1]}</span>
        </>
      )}
    </div>
  )
}

function JsonTree({ data }: { data: unknown }) {
  const value = data as JsonValue
  return (
    <Box className={chatClasses.jsonTree}>
      <JsonNode value={value} depth={0} defaultCollapsed={true} />
    </Box>
  )
}

function isVisualizationPayload(data: unknown): boolean {
  if (!data || typeof data !== 'object') {
    return false
  }

  const candidate = data as { format?: string; spec?: unknown }
  if (candidate.spec === undefined) {
    return false
  }

  return (
    candidate.format === 'vega' ||
    candidate.format === 'vega-lite' ||
    candidate.format === 'plotly' ||
    candidate.format === 'json'
  )
}

function ToolExecutionBlock({
  block,
}: {
  block: Extract<ChatContentBlock, { type: 'tool_execution' }>
}) {
  const [showBodyExpanded, setShowBodyExpanded] = useState(false)
  const [showTimeline, setShowTimeline] = useState(false)
  const [copied, setCopied] = useState(false)
  const [userToggled, setUserToggled] = useState(false)
  const hasNumericProgress =
    typeof block.value === 'number' &&
    typeof block.max === 'number' &&
    block.max > 0
  const percent = hasNumericProgress
    ? Math.min((block.value! / block.max!) * 100, 100)
    : null
  const status = block.status || 'pending'

  // Auto-expand while running (so progress is visible), collapse when done.
  // Manual toggling by the user always takes precedence after that point.
  useEffect(() => {
    if (userToggled) return
    if (status === 'running') setShowBodyExpanded(true)
    else if (status === 'complete' || status === 'error')
      setShowBodyExpanded(false)
  }, [status, userToggled])
  const statusTone =
    status === 'complete'
      ? 'success'
      : status === 'error'
        ? 'error'
        : status === 'running'
          ? 'active'
          : 'idle'
  const statusColor =
    statusTone === 'success'
      ? 'dark'
      : statusTone === 'error'
        ? 'red'
        : statusTone === 'active'
          ? 'yellow'
          : 'gray'
  const cardBorderColor =
    statusTone === 'success'
      ? 'var(--mantine-color-gray-5)'
      : statusTone === 'error'
        ? 'var(--mantine-color-red-6)'
        : statusTone === 'active'
          ? 'var(--mantine-color-yellow-6)'
          : 'var(--mantine-color-gray-5)'
  const cardClassName =
    statusTone === 'success'
      ? chatClasses.toolCardSuccess
      : statusTone === 'error'
        ? chatClasses.toolCardError
        : statusTone === 'active'
          ? chatClasses.toolCardActive
          : chatClasses.toolCardDefault
  const statusLabel =
    status === 'complete'
      ? 'Complete'
      : status === 'error'
        ? 'Error'
        : status === 'running'
          ? 'Running'
          : 'Pending'

  const startedAt = block.startedAt
    ? (parseApiDateTime(block.startedAt)?.getTime() ?? NaN)
    : NaN
  const completedAt = block.completedAt
    ? (parseApiDateTime(block.completedAt)?.getTime() ?? NaN)
    : NaN
  const hasStart = Number.isFinite(startedAt)
  const hasCompletion = Number.isFinite(completedAt)
  const durationLabel =
    hasStart && (hasCompletion || status === 'running')
      ? formatDurationMs(
          Math.max(0, (hasCompletion ? completedAt : Date.now()) - startedAt),
        )
      : null

  const serializedOutput =
    block.data === undefined ? null : safeSerialize(block.data)
  const hideSerializedOutput = isVisualizationPayload(block.data)
  const outputByteSize = serializedOutput
    ? new TextEncoder().encode(serializedOutput).length
    : 0
  const timeline = block.timeline || []
  const startedAtLabel = block.startedAt
    ? formatLocalTime(block.startedAt)
    : null
  const completedAtLabel = block.completedAt
    ? formatLocalTime(block.completedAt)
    : null
  const hasBodyContent =
    percent !== null ||
    status === 'running' ||
    !!durationLabel ||
    !!block.detail ||
    !!block.summary ||
    serializedOutput !== null ||
    timeline.length > 0 ||
    !!startedAtLabel ||
    !!completedAtLabel

  const copyOutput = async () => {
    if (!serializedOutput) {
      return
    }

    try {
      await navigator.clipboard.writeText(serializedOutput)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard may be unavailable in some contexts; silently ignore.
    }
  }

  return (
    <Paper
      withBorder
      radius='md'
      p='sm'
      className={cardClassName}
      style={{ borderColor: cardBorderColor }}
    >
      <Stack gap='xs'>
        <Group justify='space-between' align='flex-start' wrap='wrap' gap='xs'>
          <Group
            gap='xs'
            align='center'
            style={{ minWidth: 0, flex: '1 1 220px' }}
          >
            <Text
              size='xs'
              fw={700}
              className={chatClasses.toolLabel}
              style={{
                letterSpacing: 0.6,
                textTransform: 'uppercase',
                padding: '2px 6px',
                borderRadius: 999,
                border: '1px solid',
                lineHeight: 1.1,
              }}
            >
              Tool
            </Text>
            <Text fw={600} style={{ minWidth: 0 }} truncate='end'>
              {block.label || block.toolName}
            </Text>
          </Group>
          <Group gap='xs' style={{ flexShrink: 0 }}>
            {percent !== null && (
              <Text size='xs' c='dimmed'>
                {Math.round(percent)}%
              </Text>
            )}

            <Badge size='sm' variant='light' color={statusColor}>
              {statusLabel}
            </Badge>
          </Group>
        </Group>

        {showBodyExpanded && (
          <>
            {percent !== null && (
              <Progress
                value={percent}
                animated={status === 'running'}
                color={statusColor}
              />
            )}

            {percent === null && status === 'running' && (
              <Progress value={100} animated color={statusColor} />
            )}

            {block.detail && (
              <Text size='xs' c='dimmed'>
                {block.detail}
              </Text>
            )}
            {block.summary && <Text size='sm'>{block.summary}</Text>}
            {serializedOutput !== null &&
              !hideSerializedOutput &&
              (typeof block.data === 'object' && block.data !== null ? (
                <JsonTree data={block.data} />
              ) : (
                <Code block>{serializedOutput}</Code>
              ))}
            {hideSerializedOutput && (
              <Text size='xs' c='dimmed'>
                Visualization rendered below.
              </Text>
            )}
            <Group gap='xs'>
              {serializedOutput !== null && (
                <Button
                  size='compact-xs'
                  variant='filled'
                  color='gray'
                  onClick={copyOutput}
                >
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              )}
              {serializedOutput !== null && (
                <Button
                  size='compact-xs'
                  variant='filled'
                  color='gray'
                  onClick={() =>
                    downloadJson(`tool-output-${block.toolCallId}`, block.data)
                  }
                >
                  Download JSON
                </Button>
              )}
              {timeline.length > 0 && (
                <Button
                  size='compact-xs'
                  variant='subtle'
                  color='dark'
                  onClick={() => setShowTimeline((prev) => !prev)}
                >
                  {showTimeline ? 'Hide timeline' : 'Show timeline'}
                </Button>
              )}
            </Group>

            <Group gap='xs'>
              {serializedOutput !== null && (
                <Text size='xs' c='dimmed'>
                  Size: {formatBytes(outputByteSize)}
                </Text>
              )}
              {startedAtLabel && (
                <Text size='xs' c='dimmed'>
                  Started: {startedAtLabel}
                </Text>
              )}
              {completedAtLabel && (
                <Text size='xs' c='dimmed'>
                  Finished: {completedAtLabel}
                </Text>
              )}
              {durationLabel && (
                <Text size='xs' c='dimmed'>
                  Elapsed: {durationLabel}
                </Text>
              )}
            </Group>

            {showTimeline && timeline.length > 0 && (
              <div className={chatClasses.timelineSection}>
                <Stack gap={4}>
                  {timeline.map((entry, idx) => (
                    <Text
                      key={`${entry.type}-${entry.at}-${idx}`}
                      size='xs'
                      c='dimmed'
                    >
                      [{formatLocalTime(entry.at) ?? 'Unknown'}] {entry.type}
                      {entry.detail ? ` - ${entry.detail}` : ''}
                      {typeof entry.value === 'number' &&
                      typeof entry.max === 'number'
                        ? ` (${entry.value}/${entry.max})`
                        : ''}
                      {entry.summary ? ` - ${entry.summary}` : ''}
                    </Text>
                  ))}
                </Stack>
              </div>
            )}
          </>
        )}

        {hasBodyContent && (
          <Button
            size='compact-xs'
            variant='subtle'
            color='dark'
            onClick={() => {
              setUserToggled(true)
              setShowBodyExpanded((prev) => !prev)
            }}
          >
            {showBodyExpanded ? 'Show less' : 'Show more'}
          </Button>
        )}
      </Stack>
    </Paper>
  )
}

function ChatBlockView({
  block,
  mentionTone,
  mentionNames,
  onPromptResponse,
}: {
  block: ChatContentBlock
  mentionTone: 'light' | 'dark'
  mentionNames: string[]
  onPromptResponse?: (
    promptId: string,
    response: string | boolean | string[],
  ) => void
}) {
  if (block.type === 'markdown') {
    return (
      <Text component='div'>
        <Typography>
          <Markdown
            remarkPlugins={[remarkGfm]}
            components={{
              p: ({ children }) => (
                <p>
                  {highlightMentionNode(children, mentionTone, mentionNames)}
                </p>
              ),
              li: ({ children }) => (
                <li>
                  {highlightMentionNode(children, mentionTone, mentionNames)}
                </li>
              ),
              strong: ({ children }) => (
                <strong>
                  {highlightMentionNode(children, mentionTone, mentionNames)}
                </strong>
              ),
              em: ({ children }) => (
                <em>
                  {highlightMentionNode(children, mentionTone, mentionNames)}
                </em>
              ),
              blockquote: ({ children }) => (
                <blockquote>
                  {highlightMentionNode(children, mentionTone, mentionNames)}
                </blockquote>
              ),
              table: ({ children }) => (
                <div
                  className={chatClasses.markdownTableScroll}
                  role='region'
                  aria-label='Scrollable table'
                  tabIndex={0}
                >
                  <table className={chatClasses.markdownTable}>
                    {children}
                  </table>
                </div>
              ),
              th: ({ children }) => (
                <th>
                  {highlightMentionNode(children, mentionTone, mentionNames)}
                </th>
              ),
              td: ({ children }) => (
                <td>
                  {highlightMentionNode(children, mentionTone, mentionNames)}
                </td>
              ),
            }}
          >
            {normalizeAsciiTables(block.text)}
          </Markdown>
        </Typography>
      </Text>
    )
  }

  if (block.type === 'status') {
    return (
      <Alert color={block.tone === 'error' ? 'red' : 'blue'}>
        {block.text}
      </Alert>
    )
  }

  if (block.type === 'tool_execution') {
    return <ToolExecutionBlock block={block} />
  }

  if (block.type === 'progress') {
    return (
      <ToolExecutionBlock
        block={{
          type: 'tool_execution',
          toolCallId: block.toolCallId || `progress-${block.label}`,
          toolName: block.label,
          label: block.label,
          value: block.value,
          max: block.max,
          detail: block.detail,
          status: block.status,
        }}
      />
    )
  }

  if (block.type === 'tool_result') {
    return (
      <ToolExecutionBlock
        block={{
          type: 'tool_execution',
          toolCallId: block.toolCallId || `result-${block.toolName}`,
          toolName: block.toolName,
          label: block.toolName,
          status: 'complete',
          summary: block.summary,
          data: block.data,
          displayHint: block.displayHint,
        }}
      />
    )
  }

  if (block.type === 'prompt') {
    return <PromptBlock block={block} onPromptResponse={onPromptResponse} />
  }

  if (block.type === 'visualization') {
    return (
      <Stack gap='xs'>
        {block.title && <Text fw={600}>{block.title}</Text>}
        <VisualizationBlock block={block} />
      </Stack>
    )
  }

  if (block.type === 'image') {
    return <ImageBlock block={block} />
  }

  if (block.type === 'attachment') {
    return (
      <Tooltip label={`Download ${block.name}`}>
        <Badge
          component='a'
          href={`data:${block.mimeType};base64,${block.data}`}
          download={block.name}
          leftSection={<IHubIconFile size={14} />}
          size='lg'
          radius='sm'
          variant='light'
          color='gray'
          tt='none'
          className={chatClasses.attachmentBadge}
          aria-label={`Download ${block.name}, ${formatBytes(block.size)}`}
        >
          {block.name} · {formatBytes(block.size)}
        </Badge>
      </Tooltip>
    )
  }

  return <Code block>{JSON.stringify(block.data, null, 2)}</Code>
}

export default function ChatArea({
  chatParticipants,
  chatHistory,
  otherAgentTyping,
  currentUser,
  onPromptResponse,
}: ChatAreaProps) {
  const { colorScheme } = useMantineColorScheme()

  /**
   * mapping from user id to chat participant
   */
  const userLookup: { [key: string]: ChatParticipant } = {}
  chatParticipants.forEach((participant) => {
    userLookup[participant.userId] = participant
  })

  /**
   * TODO: We need to determine the logged-in user's username
   * as a placeholder, we pick the first user
   */

  const THIS_USER = currentUser.id
  const mentionNames = chatParticipants
    .map((participant) => participant.userName)
    .filter((name): name is string => Boolean(name))

  const chat = chatHistory.map((val, idx) => {
    if (val.display) {
      const messageId = val.id || `chat-${idx}`
      const blocks = normalizeMessageBlocks(val)
      const isCurrentUser = val.senderId === THIS_USER
      const sender = userLookup[val.senderId]
      const senderName = sender?.userName || 'Unknown User'
      const timestampLabel = val.timestamp
        ? (formatLocalDateTime(val.timestamp, {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          }) ?? '')
        : ''
      const senderInitials = senderName
        .split(' ')
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0])
        .join('')
        .toUpperCase()

      const avatarColor = isCurrentUser
        ? 'blue'
        : sender?.userRole === 'assistant' || sender?.userRole === 'ai'
          ? 'dark'
          : 'gray'
      const senderNameColor = isCurrentUser
        ? colorScheme === 'dark'
          ? 'var(--mantine-color-blue-3)'
          : 'var(--mantine-color-blue-7)'
        : colorScheme === 'dark'
          ? 'var(--mantine-color-gray-2)'
          : 'var(--mantine-color-gray-7)'

      return (
        <div key={messageId} className={chatClasses.messageContainer}>
          <Avatar size='md' radius='xl' color={avatarColor}>
            {senderInitials || '?'}
          </Avatar>

          <Box className={chatClasses.messageContent}>
            <Box className={chatClasses.messageHeader}>
              <Text
                size='sm'
                c={senderNameColor}
                className={chatClasses.messageSenderName}
                truncate='end'
              >
                {senderName}
              </Text>
              {timestampLabel && (
                <Text
                  size='xs'
                  c={senderNameColor}
                  className={chatClasses.messageTimestamp}
                >
                  {timestampLabel}
                </Text>
              )}
            </Box>
            <Box
              maw={'100%'}
              p='sm'
              bdrs={'md'}
              className={
                isCurrentUser
                  ? chatClasses.messageBubbleUser
                  : chatClasses.messageBubbleOther
              }
            >
              <Stack gap='sm'>
                {blocks.map((block, blockIndex) => (
                  <ChatBlockView
                    key={`${val.id || idx}-${block.type}-${blockIndex}`}
                    block={block}
                    mentionTone={isCurrentUser ? 'dark' : 'light'}
                    mentionNames={mentionNames}
                    onPromptResponse={onPromptResponse}
                  />
                ))}
              </Stack>
            </Box>
          </Box>
        </div>
      )
    }
  })

  return (
    <Box key={`chat-area`} mx={'lg'} className={chatClasses.chatAreaContainer}>
      {chat}
      {otherAgentTyping && (
        <ActionIcon
          variant='subtle'
          size={'xl'}
          color={'var(--mantine-color-gray-7)'}
          loading
          loaderProps={{ type: 'dots' }}
        />
      )}
    </Box>
  )
}
