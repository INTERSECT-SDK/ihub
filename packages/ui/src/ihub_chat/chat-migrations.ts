import type {
  ChatContentBlock,
  ChatData,
  ChatMessage,
} from '@ihub/utils/types/chat'

/**
 * Creates a client-side chat message id with a stable domain prefix.
 *
 * Uses `crypto.randomUUID` when available and falls back to a timestamp plus
 * random suffix for browser contexts that do not expose the crypto API.
 */
export function createMessageId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Converts persisted chat ids into websocket conversation ids.
 *
 * Older persisted chats may use `chat-<uuid>` ids while the websocket protocol
 * expects the raw UUID. Non-prefixed ids are returned unchanged.
 */
export function normalizeConversationId(rawId?: string): string | null {
  if (!rawId) {
    return null
  }

  const prefixed = rawId.match(/^chat-([0-9a-fA-F-]{36})$/)
  if (prefixed?.[1]) {
    return prefixed[1]
  }

  return rawId
}

/**
 * Creates a conversation id suitable for websocket session events.
 *
 * The fallback preserves UUID shape so existing backend parsing and persisted
 * chat compatibility do not depend on browser crypto support.
 */
export function createConversationId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const rnd = Math.floor(Math.random() * 16)
    const value = char === 'x' ? rnd : (rnd & 0x3) | 0x8
    return value.toString(16)
  })
}

/**
 * Normalizes string or rich message content into a mutable block array.
 *
 * Empty text produces no blocks; non-empty text becomes a markdown block so
 * reducers can append rich content without special casing legacy text messages.
 */
export function toBlocks(content: ChatMessage['content']): ChatContentBlock[] {
  if (Array.isArray(content)) {
    return [...content]
  }

  if (!String(content || '').trim()) {
    return []
  }

  return [
    {
      type: 'markdown',
      text: String(content),
    },
  ]
}

/**
 * Converts supported tool result payloads into visualization content blocks.
 *
 * Returns `null` for ordinary tool output so callers can keep that data on the
 * tool execution block instead of appending a separate visualization.
 */
export function deriveVisualizationBlock(
  result: unknown,
): ChatContentBlock | null {
  if (!result || typeof result !== 'object') {
    return null
  }

  const candidate = result as {
    format?: string
    spec?: unknown
    title?: string
  }

  if (!candidate.format || candidate.spec === undefined) {
    return null
  }

  if (
    candidate.format === 'vega' ||
    candidate.format === 'vega-lite' ||
    candidate.format === 'plotly' ||
    candidate.format === 'json'
  ) {
    return {
      type: 'visualization',
      title: candidate.title,
      format: candidate.format,
      spec: candidate.spec,
    }
  }

  return null
}

type ImageBlock = Extract<ChatContentBlock, { type: 'image' }>
type SupportedImageMimeType = ImageBlock['mimeType']

export type NormalizedToolResultImages = {
  imageBlocks: ImageBlock[]
  compactedResult: unknown
}

const MAX_IMAGE_BASE64_LENGTH = 12 * 1024 * 1024
const MAX_JSON_TEXT_LENGTH = 16 * 1024 * 1024
const MAX_TOOL_RESULT_NODES = 500
const MAX_TOOL_RESULT_DEPTH = 6
const STORED_IMAGE_MARKER = '[stored as image block]'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function getImageIdentity(image: ImageBlock): string {
  return `${image.mimeType}:${image.data.replace(/\s/g, '')}`
}

function normalizeImageMimeType(value: unknown): SupportedImageMimeType | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.toLowerCase().split(';', 1)[0]?.trim()
  if (normalized === 'image/jpg') {
    return 'image/jpeg'
  }

  if (
    normalized === 'image/png' ||
    normalized === 'image/jpeg' ||
    normalized === 'image/gif' ||
    normalized === 'image/webp'
  ) {
    return normalized
  }

  return null
}

function decodeBase64Prefix(value: string): Uint8Array | null {
  const normalized = value.replace(/\s/g, '')
  if (
    normalized.length < 16 ||
    normalized.length > MAX_IMAGE_BASE64_LENGTH ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)
  ) {
    return null
  }

  const prefixLength = Math.min(64, normalized.length)
  const prefix = normalized.slice(0, prefixLength)
  const paddedPrefix = prefix.padEnd(Math.ceil(prefix.length / 4) * 4, '=')

  try {
    const decoded = atob(paddedPrefix)
    return Uint8Array.from(decoded, (char) => char.charCodeAt(0))
  } catch {
    return null
  }
}

function hasBytes(bytes: Uint8Array, expected: number[], offset = 0): boolean {
  return expected.every((byte, index) => bytes[offset + index] === byte)
}

function detectBase64ImageMimeType(
  value: string,
): SupportedImageMimeType | null {
  const bytes = decodeBase64Prefix(value)
  if (!bytes) {
    return null
  }

  if (hasBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png'
  }
  if (hasBytes(bytes, [0xff, 0xd8, 0xff])) {
    return 'image/jpeg'
  }
  if (
    hasBytes(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
    hasBytes(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
  ) {
    return 'image/gif'
  }
  if (
    hasBytes(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    hasBytes(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return 'image/webp'
  }

  return null
}

function getImageDimensions(
  container: Record<string, unknown>,
): Pick<ImageBlock, 'width' | 'height'> {
  if (
    typeof container.width === 'number' &&
    typeof container.height === 'number'
  ) {
    return {
      width: container.width,
      height: container.height,
    }
  }

  const shape = container.image_shape || container.imageShape
  if (
    !Array.isArray(shape) ||
    typeof shape[0] !== 'number' ||
    typeof shape[1] !== 'number'
  ) {
    return {}
  }

  return {
    height: shape[0],
    width: shape[1],
  }
}

function looksLikeImagePath(path: string): boolean {
  return /(?:image|img|thumbnail|thumb|preview|png|jpe?g|gif|webp)/i.test(path)
}

function parseImageDataUrl(
  value: string,
): Pick<ImageBlock, 'data' | 'mimeType'> | null {
  const match = value.match(/^data:([^;,]+);base64,([\s\S]+)$/i)
  if (!match?.[1] || !match[2]) {
    return null
  }

  const declaredMimeType = normalizeImageMimeType(match[1])
  const detectedMimeType = detectBase64ImageMimeType(match[2])
  if (!declaredMimeType || declaredMimeType !== detectedMimeType) {
    return null
  }

  return {
    data: match[2].replace(/\s/g, ''),
    mimeType: detectedMimeType,
  }
}

function getJsonNumberTokens(value: string): string[] {
  const tokens: string[] = []
  const numberPattern = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y
  let index = 0
  let inString = false

  while (index < value.length) {
    const character = value.charAt(index)
    if (inString) {
      if (character === '\\') {
        index += 2
        continue
      }
      if (character === '"') {
        inString = false
      }
      index += 1
      continue
    }

    if (character === '"') {
      inString = true
      index += 1
      continue
    }

    if (character === '-' || (character >= '0' && character <= '9')) {
      numberPattern.lastIndex = index
      const match = numberPattern.exec(value)
      if (match) {
        tokens.push(match[0])
        index = numberPattern.lastIndex
        continue
      }
    }

    index += 1
  }

  return tokens
}

function jsonNumbersRoundTrip(value: string, parsedValue: unknown): boolean {
  const serializedValue = JSON.stringify(parsedValue)
  if (serializedValue === undefined) {
    return false
  }

  const originalTokens = getJsonNumberTokens(value)
  const serializedTokens = getJsonNumberTokens(serializedValue)
  return (
    originalTokens.length === serializedTokens.length &&
    originalTokens.every((token, index) => token === serializedTokens[index])
  )
}

function parseJsonToolText(value: string, path: string): unknown | null {
  if (
    !path.endsWith('.text') ||
    value.length > MAX_JSON_TEXT_LENGTH ||
    !['{', '['].includes(value.trimStart()[0] || '')
  ) {
    return null
  }

  try {
    const parsedValue: unknown = JSON.parse(value)
    return jsonNumbersRoundTrip(value, parsedValue) ? parsedValue : null
  } catch {
    return null
  }
}

/**
 * Extracts MCP image payloads while removing their duplicate persisted bytes.
 *
 * Traversal is bounded by node count, nesting depth, and encoded string size.
 * Key names are only hints: decoded magic bytes must identify a supported
 * raster format. All fields other than recognized image bytes are retained,
 * including metadata embedded in JSON text content. JSON text is only
 * compacted when every numeric token survives native parsing unchanged.
 */
export function normalizeToolResultImages(
  result: unknown,
): NormalizedToolResultImages {
  const images: ImageBlock[] = []
  const seenImages = new Set<string>()
  let visitedNodes = 0

  const addImage = (image: ImageBlock) => {
    const identity = getImageIdentity(image)
    if (seenImages.has(identity)) {
      return
    }

    seenImages.add(identity)
    images.push(image)
  }

  const visit = (
    value: unknown,
    path: string,
    depth: number,
    parent?: Record<string, unknown>,
  ): { value: unknown; changed: boolean } => {
    visitedNodes += 1
    if (visitedNodes > MAX_TOOL_RESULT_NODES || depth > MAX_TOOL_RESULT_DEPTH) {
      return { value, changed: false }
    }

    if (typeof value === 'string') {
      const dataUrl = parseImageDataUrl(value)
      if (dataUrl) {
        addImage({
          type: 'image',
          ...dataUrl,
          ...getImageDimensions(parent || {}),
          alt: 'Tool-generated image',
          sourcePath: path,
        })
        return { value: STORED_IMAGE_MARKER, changed: true }
      }

      if (looksLikeImagePath(path)) {
        const mimeType = detectBase64ImageMimeType(value)
        if (mimeType) {
          addImage({
            type: 'image',
            data: value.replace(/\s/g, ''),
            mimeType,
            ...getImageDimensions(parent || {}),
            alt: 'Tool-generated image',
            sourcePath: path,
          })
          return { value: STORED_IMAGE_MARKER, changed: true }
        }
      }

      const parsedToolText = parseJsonToolText(value, path)
      if (parsedToolText !== null) {
        const normalizedText = visit(parsedToolText, `${path}.json`, depth + 1)
        if (normalizedText.changed) {
          return {
            value: JSON.stringify(normalizedText.value),
            changed: true,
          }
        }
      }
      return { value, changed: false }
    }

    if (Array.isArray(value)) {
      let changed = false
      const normalizedItems = value.map((item, index) => {
        const normalizedItem = visit(
          item,
          `${path}[${index}]`,
          depth + 1,
          parent,
        )
        changed ||= normalizedItem.changed
        return normalizedItem.value
      })
      return { value: changed ? normalizedItems : value, changed }
    }

    if (!isRecord(value)) {
      return { value, changed: false }
    }

    if (value.type === 'image' && typeof value.data === 'string') {
      const declaredMimeType = normalizeImageMimeType(value.mimeType)
      const detectedMimeType = detectBase64ImageMimeType(value.data)
      if (detectedMimeType && declaredMimeType === detectedMimeType) {
        addImage({
          type: 'image',
          data: value.data.replace(/\s/g, ''),
          mimeType: detectedMimeType,
          ...getImageDimensions(value),
          alt:
            typeof value.alt === 'string' ? value.alt : 'Tool-generated image',
          sourcePath: path,
        })
        return {
          value: {
            ...value,
            data: STORED_IMAGE_MARKER,
          },
          changed: true,
        }
      }
    }

    let changed = false
    const normalizedEntries = Object.entries(value).map(([key, item]) => {
      const normalizedItem = visit(
        item,
        path ? `${path}.${key}` : key,
        depth + 1,
        value,
      )
      changed ||= normalizedItem.changed
      return [key, normalizedItem.value] as const
    })

    return {
      value: changed ? Object.fromEntries(normalizedEntries) : value,
      changed,
    }
  }

  const normalizedResult = visit(result, '', 0)
  return {
    imageBlocks: images,
    compactedResult: normalizedResult.value,
  }
}

/**
 * Finds standard MCP images and common nonstandard base64 image fields.
 *
 * Prefer `normalizeToolResultImages` when retaining the result because it also
 * removes duplicate image bytes from the persisted tool-result data.
 */
export function deriveImageBlocks(result: unknown): ImageBlock[] {
  return normalizeToolResultImages(result).imageBlocks
}

/**
 * Builds the local user message appended before a websocket user event is sent.
 *
 * The message is immediately marked complete because streaming status belongs
 * to assistant responses, not submitted user text.
 */
export function createUserMessage(
  currentUserId: string,
  content: string,
  attachments: Extract<ChatContentBlock, { type: 'attachment' }>[] = [],
): ChatMessage {
  const messageContent: ChatMessage['content'] = attachments.length
    ? [
        ...(content.trim()
          ? [{ type: 'markdown' as const, text: content }]
          : []),
        ...attachments,
      ]
    : content

  return {
    id: createMessageId('user'),
    senderId: currentUserId,
    content: messageContent,
    timestamp: new Date().toISOString(),
    messageType: attachments.length ? 'rich' : 'text',
    status: 'complete',
    display: true,
    flowcept: false,
  }
}

/**
 * Migrates legacy progress and tool result blocks to tool execution blocks.
 *
 * Progress and result blocks with the same tool call id are merged into one
 * execution block so old persisted chats render through the current timeline UI
 * without duplicating tool output.
 */
export function migrateMessageBlocks(
  blocks: ChatContentBlock[],
): ChatContentBlock[] {
  const migrated: ChatContentBlock[] = []
  const toolExecutionByCallId = new Map<string, number>()

  blocks.forEach((block, index) => {
    if (block.type !== 'progress' && block.type !== 'tool_result') {
      migrated.push(block)
      return
    }

    const toolCallId = block.toolCallId || `legacy-${block.type}-${index}`
    const existingIndex = toolExecutionByCallId.get(toolCallId)
    const existing =
      existingIndex !== undefined &&
      migrated[existingIndex]?.type === 'tool_execution'
        ? migrated[existingIndex]
        : null

    const nextBlock: Extract<ChatContentBlock, { type: 'tool_execution' }> = {
      type: 'tool_execution',
      toolCallId,
      toolName:
        block.type === 'tool_result'
          ? block.toolName
          : existing?.toolName || block.label,
      label: block.type === 'tool_result' ? block.toolName : block.label,
      value: block.type === 'progress' ? block.value : existing?.value,
      max: block.type === 'progress' ? block.max : existing?.max,
      detail: block.type === 'progress' ? block.detail : existing?.detail,
      status:
        block.type === 'tool_result'
          ? 'complete'
          : block.status || existing?.status,
      summary: block.type === 'tool_result' ? block.summary : existing?.summary,
      data: block.type === 'tool_result' ? block.data : existing?.data,
      displayHint:
        block.type === 'tool_result'
          ? block.displayHint
          : existing?.displayHint,
      startedAt: existing?.startedAt,
      completedAt:
        block.type === 'tool_result'
          ? existing?.completedAt || new Date().toISOString()
          : existing?.completedAt,
      timeline: existing?.timeline,
    }

    if (existingIndex !== undefined) {
      migrated[existingIndex] = nextBlock
      return
    }

    toolExecutionByCallId.set(toolCallId, migrated.length)
    migrated.push(nextBlock)
  })

  const existingImageIdentities = new Set(
    migrated
      .filter((block): block is ImageBlock => block.type === 'image')
      .map(getImageIdentity),
  )
  const emittedImageIdentities = new Set<string>()
  const normalized: ChatContentBlock[] = []

  migrated.forEach((block) => {
    if (block.type === 'image') {
      const canonicalImageBlock = {
        ...block,
        data: block.data.replace(/\s/g, ''),
      }
      const identity = getImageIdentity(canonicalImageBlock)
      if (!emittedImageIdentities.has(identity)) {
        emittedImageIdentities.add(identity)
        normalized.push(canonicalImageBlock)
      }
      return
    }

    if (block.type !== 'tool_execution' || block.data === undefined) {
      normalized.push(block)
      return
    }

    const { compactedResult, imageBlocks } = normalizeToolResultImages(
      block.data,
    )
    normalized.push({
      ...block,
      data: compactedResult,
    })

    imageBlocks.forEach((imageBlock) => {
      const identity = getImageIdentity(imageBlock)
      if (
        existingImageIdentities.has(identity) ||
        emittedImageIdentities.has(identity)
      ) {
        return
      }

      emittedImageIdentities.add(identity)
      normalized.push(imageBlock)
    })
  })

  return normalized
}

/**
 * Applies chat content migration to persisted chat data.
 *
 * Text messages are intentionally left unchanged; only rich content arrays are
 * inspected for legacy blocks that need conversion.
 */
export function migrateChatData(chatData: ChatData): ChatData {
  return {
    ...chatData,
    messages: chatData.messages.map((message) => {
      if (!Array.isArray(message.content)) {
        return message
      }

      return {
        ...message,
        content: migrateMessageBlocks(message.content),
      }
    }),
  }
}
