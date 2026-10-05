import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ChatData } from '@ihub/utils/types/chat'

import {
  createUserMessage,
  deriveImageBlocks,
  migrateChatData,
  normalizeToolResultImages,
} from './chat-migrations'

const pngBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAMAAAADACAIAAADdvvtQAAAA/0lEQVR4nO3XwQnCQBAF0L8bBMUCckgnXnO1MsuwHnsQBKsIUU+CoAFvMfIeU8Bn+SwzCQAAAAAAAABvytwBflh5zv05vFGgCSVpklXSJGMyJKMO8b2abNIdu/113x27bJI6dySWpEm26S/96X7qL322STN3JJakJuu0h3Z33rWHNms/0Gd2oAklqckqqcktGZKbHegDBZpWXp7HFQYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPAHHl+KGKKmz/AHAAAAAElFTkSuQmCC'
const gifBase64 = 'R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='

const baseChatData: ChatData = {
  chatId: 'chat-1',
  chatName: 'Test chat',
  participants: [],
  messages: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

test('createUserMessage persists attachments as rich content', () => {
  const message = createUserMessage('user-1', 'Review this', [
    {
      type: 'attachment',
      id: 'attachment-1',
      name: 'report.pdf',
      mimeType: 'application/pdf',
      size: 4,
      data: 'JVBERg==',
    },
  ])

  assert.equal(message.messageType, 'rich')
  assert.deepEqual(message.content, [
    { type: 'markdown', text: 'Review this' },
    {
      type: 'attachment',
      id: 'attachment-1',
      name: 'report.pdf',
      mimeType: 'application/pdf',
      size: 4,
      data: 'JVBERg==',
    },
  ])
})

test('migrateChatData converts legacy progress blocks to tool execution blocks', () => {
  const migrated = migrateChatData({
    ...baseChatData,
    messages: [
      {
        id: 'message-1',
        senderId: 'agent-1',
        timestamp: '2026-01-01T00:00:00.000Z',
        messageType: 'rich',
        status: 'streaming',
        display: true,
        content: [
          {
            type: 'progress',
            toolCallId: 'tool-1',
            label: 'Search',
            value: 2,
            max: 5,
            detail: 'Looking',
            status: 'running',
          },
        ],
      },
    ],
  })

  const content = migrated.messages[0]?.content
  assert.equal(Array.isArray(content), true)
  if (!Array.isArray(content)) {
    throw new Error('Expected migrated content blocks')
  }

  const block = content[0]
  assert.equal(block?.type, 'tool_execution')
  if (block?.type === 'tool_execution') {
    assert.equal(block.toolCallId, 'tool-1')
    assert.equal(block.toolName, 'Search')
    assert.equal(block.label, 'Search')
    assert.equal(block.value, 2)
    assert.equal(block.max, 5)
    assert.equal(block.detail, 'Looking')
    assert.equal(block.status, 'running')
  }
})

test('migrateChatData merges legacy tool results into matching tool execution blocks', () => {
  const migrated = migrateChatData({
    ...baseChatData,
    messages: [
      {
        id: 'message-1',
        senderId: 'agent-1',
        timestamp: '2026-01-01T00:00:00.000Z',
        messageType: 'rich',
        status: 'streaming',
        display: true,
        content: [
          {
            type: 'progress',
            toolCallId: 'tool-1',
            label: 'Search',
            status: 'running',
          },
          {
            type: 'tool_result',
            toolCallId: 'tool-1',
            toolName: 'Search',
            summary: 'Found result',
            data: { value: 42 },
            displayHint: 'json',
          },
        ],
      },
    ],
  })

  const content = migrated.messages[0]?.content
  assert.equal(Array.isArray(content), true)
  if (!Array.isArray(content)) {
    throw new Error('Expected migrated content blocks')
  }
  assert.equal(content.length, 1)

  const block = content[0]
  assert.equal(block?.type, 'tool_execution')
  if (block?.type === 'tool_execution') {
    assert.equal(block.status, 'complete')
    assert.equal(block.summary, 'Found result')
    assert.deepEqual(block.data, { value: 42 })
    assert.equal(block.displayHint, 'json')
  }
})

test('migrateChatData leaves text content unchanged', () => {
  const original = {
    ...baseChatData,
    messages: [
      {
        id: 'message-1',
        senderId: 'agent-1',
        timestamp: '2026-01-01T00:00:00.000Z',
        messageType: 'text' as const,
        status: 'complete' as const,
        display: true,
        content: 'Plain text',
      },
    ],
  }

  assert.deepEqual(migrateChatData(original).messages[0], original.messages[0])
})

test('deriveImageBlocks detects nonstandard base64 thumbnail fields', () => {
  const blocks = deriveImageBlocks({
    success: true,
    thumbnail_png_b64: pngBase64,
    image_shape: [192, 192],
    n_atoms: 15,
  })

  assert.deepEqual(blocks, [
    {
      type: 'image',
      data: pngBase64,
      mimeType: 'image/png',
      width: 192,
      height: 192,
      alt: 'Tool-generated image',
      sourcePath: 'thumbnail_png_b64',
    },
  ])
})

test('deriveImageBlocks detects and deduplicates standard MCP image content', () => {
  const blocks = deriveImageBlocks({
    content: [
      {
        type: 'image',
        data: pngBase64,
        mimeType: 'image/png',
        alt: 'Diffraction thumbnail',
      },
    ],
    structuredContent: {
      thumbnail_png_b64: pngBase64,
    },
  })

  assert.equal(blocks.length, 1)
  assert.equal(blocks[0]?.mimeType, 'image/png')
  assert.equal(blocks[0]?.alt, 'Diffraction thumbnail')
  assert.equal(blocks[0]?.sourcePath, 'content[0]')
})

test('deriveImageBlocks inspects JSON serialized in MCP text content', () => {
  const blocks = deriveImageBlocks({
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          thumbnail_png_b64: pngBase64,
          image_shape: [192, 192],
        }),
      },
    ],
  })

  assert.equal(blocks.length, 1)
  assert.equal(blocks[0]?.mimeType, 'image/png')
  assert.equal(blocks[0]?.sourcePath, 'content[0].text.json.thumbnail_png_b64')
})

test('deriveImageBlocks rejects mislabeled or non-image base64 data', () => {
  assert.deepEqual(
    deriveImageBlocks({
      content: [
        {
          type: 'image',
          data: pngBase64,
          mimeType: 'image/jpeg',
        },
      ],
      thumbnail_b64: btoa('this is not an image'),
    }),
    [],
  )
})

test('normalizeToolResultImages compacts standard MCP image data', () => {
  const result = {
    content: [
      {
        type: 'image',
        data: pngBase64,
        mimeType: 'image/png',
        alt: 'Diffraction thumbnail',
        width: 192,
        height: 192,
        metadata: { atoms: 15 },
      },
    ],
    model: 'example-model',
  }

  const normalized = normalizeToolResultImages(result)

  assert.deepEqual(normalized.imageBlocks, [
    {
      type: 'image',
      data: pngBase64,
      mimeType: 'image/png',
      width: 192,
      height: 192,
      alt: 'Diffraction thumbnail',
      sourcePath: 'content[0]',
    },
  ])
  assert.deepEqual(normalized.compactedResult, {
    content: [
      {
        type: 'image',
        data: '[stored as image block]',
        mimeType: 'image/png',
        alt: 'Diffraction thumbnail',
        width: 192,
        height: 192,
        metadata: { atoms: 15 },
      },
    ],
    model: 'example-model',
  })
})

test('normalizeToolResultImages removes repeated bytes across MCP result fields', () => {
  const normalized = normalizeToolResultImages({
    content: [
      {
        type: 'image',
        data: pngBase64,
        mimeType: 'image/png',
        alt: 'Canonical image',
      },
    ],
    structuredContent: {
      thumbnail_png_b64: pngBase64,
      image_shape: [192, 192],
      n_atoms: 15,
    },
  })

  assert.equal(normalized.imageBlocks.length, 1)
  assert.deepEqual(normalized.compactedResult, {
    content: [
      {
        type: 'image',
        data: '[stored as image block]',
        mimeType: 'image/png',
        alt: 'Canonical image',
      },
    ],
    structuredContent: {
      thumbnail_png_b64: '[stored as image block]',
      image_shape: [192, 192],
      n_atoms: 15,
    },
  })
  assert.equal(
    JSON.stringify({
      data: normalized.compactedResult,
      images: normalized.imageBlocks,
    }).split(pngBase64).length - 1,
    1,
  )
})

test('normalizeToolResultImages compacts images in JSON-encoded MCP text', () => {
  const normalized = normalizeToolResultImages({
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          thumbnail_png_b64: pngBase64,
          image_shape: [192, 192],
          description: 'Crystal structure',
        }),
      },
    ],
  })

  assert.equal(normalized.imageBlocks.length, 1)
  const compacted = normalized.compactedResult as {
    content: Array<{ text: string }>
  }
  assert.deepEqual(JSON.parse(compacted.content[0]?.text || ''), {
    thumbnail_png_b64: '[stored as image block]',
    image_shape: [192, 192],
    description: 'Crystal structure',
  })
})

function assertJsonTextCompactionSkipped(numberToken: string): void {
  const text =
    `{"numeric_metadata":${numberToken},` +
    `"thumbnail_png_b64":"${pngBase64}"}`
  const result = { content: [{ type: 'text', text }] }
  const normalized = normalizeToolResultImages(result)

  assert.deepEqual(normalized.imageBlocks, [])
  assert.equal(normalized.compactedResult, result)
  const compacted = normalized.compactedResult as {
    content: Array<{ text: string }>
  }
  assert.equal(compacted.content[0]?.text, text)
}

test('normalizeToolResultImages preserves JSON text containing unsafe integers', () => {
  assertJsonTextCompactionSkipped('9223372036854775807')
})

test('normalizeToolResultImages preserves JSON text with normalized exponents', () => {
  assertJsonTextCompactionSkipped('1e3')
})

test('normalizeToolResultImages preserves JSON text containing negative zero', () => {
  assertJsonTextCompactionSkipped('-0')
})

test('normalizeToolResultImages compacts JSON text with safe numeric metadata', () => {
  const normalized = normalizeToolResultImages({
    content: [
      {
        type: 'text',
        text:
          `{"count":15,"ratio":1.25,"label":"run 1e3",` +
          `"thumbnail_png_b64":"${pngBase64}"}`,
      },
    ],
  })

  assert.equal(normalized.imageBlocks.length, 1)
  const compacted = normalized.compactedResult as {
    content: Array<{ text: string }>
  }
  assert.deepEqual(JSON.parse(compacted.content[0]?.text || ''), {
    count: 15,
    ratio: 1.25,
    label: 'run 1e3',
    thumbnail_png_b64: '[stored as image block]',
  })
})

test('normalizeToolResultImages retains multiple distinct image payloads', () => {
  const normalized = normalizeToolResultImages({
    preview_png_b64: pngBase64,
    thumbnail_gif_b64: gifBase64,
    labels: ['preview', 'thumbnail'],
  })

  assert.deepEqual(
    normalized.imageBlocks.map(({ data, mimeType }) => ({ data, mimeType })),
    [
      { data: pngBase64, mimeType: 'image/png' },
      { data: gifBase64, mimeType: 'image/gif' },
    ],
  )
  assert.deepEqual(normalized.compactedResult, {
    preview_png_b64: '[stored as image block]',
    thumbnail_gif_b64: '[stored as image block]',
    labels: ['preview', 'thumbnail'],
  })
})

test('normalizeToolResultImages leaves non-image tool results unchanged', () => {
  const result = {
    content: [{ type: 'text', text: 'No image here' }],
    structuredContent: { count: 2, encoded: btoa('not an image') },
  }
  const normalized = normalizeToolResultImages(result)

  assert.deepEqual(normalized.imageBlocks, [])
  assert.equal(normalized.compactedResult, result)
})

test('normalizeToolResultImages leaves visualization results unchanged', () => {
  const result = {
    format: 'vega-lite',
    title: 'Counts',
    spec: { mark: 'bar', data: { values: [{ count: 2 }] } },
  }
  const normalized = normalizeToolResultImages(result)

  assert.deepEqual(normalized.imageBlocks, [])
  assert.equal(normalized.compactedResult, result)
})

test('migrateChatData derives missing images and compacts legacy tool data', () => {
  const migrated = migrateChatData({
    ...baseChatData,
    messages: [
      {
        id: 'message-1',
        senderId: 'agent-1',
        timestamp: '2026-01-01T00:00:00.000Z',
        messageType: 'rich',
        status: 'complete',
        display: true,
        content: [
          {
            type: 'tool_result',
            toolCallId: 'tool-1',
            toolName: 'render',
            data: {
              thumbnail_png_b64: pngBase64,
              image_shape: [192, 192],
              n_atoms: 15,
            },
          },
        ],
      },
    ],
  })

  const content = migrated.messages[0]?.content
  assert.ok(Array.isArray(content))
  assert.equal(content.length, 2)
  assert.equal(JSON.stringify(content).split(pngBase64).length - 1, 1)
  assert.deepEqual(content[0], {
    type: 'tool_execution',
    toolCallId: 'tool-1',
    toolName: 'render',
    label: 'render',
    value: undefined,
    max: undefined,
    detail: undefined,
    status: 'complete',
    summary: undefined,
    data: {
      thumbnail_png_b64: '[stored as image block]',
      image_shape: [192, 192],
      n_atoms: 15,
    },
    displayHint: undefined,
    startedAt: undefined,
    completedAt:
      content[0]?.type === 'tool_execution'
        ? content[0].completedAt
        : undefined,
    timeline: undefined,
  })
  assert.deepEqual(content[1], {
    type: 'image',
    data: pngBase64,
    mimeType: 'image/png',
    width: 192,
    height: 192,
    alt: 'Tool-generated image',
    sourcePath: 'thumbnail_png_b64',
  })
})

test('migrateChatData does not add duplicate existing image blocks', () => {
  const imageBlock = {
    type: 'image' as const,
    data: pngBase64,
    mimeType: 'image/png' as const,
    alt: 'Existing image',
  }
  const migrated = migrateChatData({
    ...baseChatData,
    messages: [
      {
        id: 'message-1',
        senderId: 'agent-1',
        timestamp: '2026-01-01T00:00:00.000Z',
        messageType: 'rich',
        status: 'complete',
        display: true,
        content: [
          {
            type: 'tool_execution',
            toolCallId: 'tool-1',
            toolName: 'render',
            data: { thumbnail_png_b64: pngBase64 },
          },
          imageBlock,
          imageBlock,
        ],
      },
    ],
  })

  const content = migrated.messages[0]?.content
  assert.ok(Array.isArray(content))
  assert.equal(JSON.stringify(content).split(pngBase64).length - 1, 1)
  assert.equal(content.filter((block) => block.type === 'image').length, 1)
})
