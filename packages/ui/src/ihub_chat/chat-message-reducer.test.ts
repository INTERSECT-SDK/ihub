import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ChatData, ChatMessage } from '@ihub/utils/types/chat'

import { chatMessageReducer } from './chat-message-reducer'

const baseChatData: ChatData = {
  chatId: 'chat-1',
  chatName: 'Test chat',
  participants: [
    {
      userId: 'user-1',
      userName: 'Test User',
      userRole: 'user',
    },
  ],
  messages: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const userMessage: ChatMessage = {
  id: 'user-message-1',
  senderId: 'user-1',
  content: 'Hello',
  timestamp: '2026-01-01T00:00:01.000Z',
  messageType: 'text',
  status: 'complete',
  display: true,
  flowcept: false,
}

test('chatMessageReducer appends user messages and updates the chat timestamp', () => {
  const state = chatMessageReducer(baseChatData, {
    type: 'append_user_message',
    message: userMessage,
    timestamp: '2026-01-01T00:00:02.000Z',
  })

  assert.deepEqual(state.messages, [userMessage])
  assert.equal(state.updatedAt, '2026-01-01T00:00:02.000Z')
})

test('chatMessageReducer ensures assistant messages idempotently', () => {
  const first = chatMessageReducer(baseChatData, {
    type: 'ensure_assistant_message',
    messageId: 'assistant-message-1',
    senderId: 'agent-1',
    timestamp: '2026-01-01T00:00:02.000Z',
  })
  const second = chatMessageReducer(first, {
    type: 'ensure_assistant_message',
    messageId: 'assistant-message-1',
    senderId: 'agent-1',
    timestamp: '2026-01-01T00:00:03.000Z',
  })

  assert.equal(second.messages.length, 1)
  assert.equal(second.messages[0]?.id, 'assistant-message-1')
  assert.equal(second.messages[0]?.status, 'streaming')
})

test('chatMessageReducer appends streaming deltas to text and markdown content', () => {
  const textState = chatMessageReducer(
    { ...baseChatData, messages: [userMessage] },
    {
      type: 'append_delta',
      messageId: 'user-message-1',
      delta: ' world',
      timestamp: '2026-01-01T00:00:02.000Z',
    },
  )

  assert.equal(textState.messages[0]?.content, 'Hello world')
  assert.equal(textState.messages[0]?.status, 'streaming')

  const richState = chatMessageReducer(
    {
      ...baseChatData,
      messages: [
        {
          ...userMessage,
          messageType: 'rich',
          content: [{ type: 'markdown', text: 'Hello' }],
        },
      ],
    },
    {
      type: 'append_delta',
      messageId: 'user-message-1',
      delta: ' world',
      timestamp: '2026-01-01T00:00:02.000Z',
    },
  )

  const richContent = richState.messages[0]?.content
  assert.equal(Array.isArray(richContent), true)
  if (!Array.isArray(richContent)) {
    throw new Error('Expected rich content blocks')
  }

  const block = richContent[0]
  assert.equal(block?.type, 'markdown')
  if (block?.type === 'markdown') {
    assert.equal(block.text, 'Hello world')
  }
})

test('chatMessageReducer updates tool execution lifecycle blocks', () => {
  const started = chatMessageReducer(
    { ...baseChatData, messages: [{ ...userMessage, senderId: 'agent-1' }] },
    {
      type: 'upsert_tool_execution',
      messageId: 'user-message-1',
      toolCallId: 'tool-1',
      timestamp: '2026-01-01T00:00:02.000Z',
      patch: {
        toolName: 'Search',
        status: 'running',
        detail: 'Running tool',
        timelineEntry: {
          type: 'start',
          at: '2026-01-01T00:00:02.000Z',
        },
      },
    },
  )

  const completed = chatMessageReducer(started, {
    type: 'upsert_tool_execution',
    messageId: 'user-message-1',
    toolCallId: 'tool-1',
    timestamp: '2026-01-01T00:00:03.000Z',
    patch: {
      toolName: 'Search',
      status: 'complete',
      summary: 'Done',
      data: { rows: 1 },
      timelineEntry: {
        type: 'result',
        at: '2026-01-01T00:00:03.000Z',
        summary: 'Done',
      },
    },
  })

  const completedContent = completed.messages[0]?.content
  assert.equal(Array.isArray(completedContent), true)
  if (!Array.isArray(completedContent)) {
    throw new Error('Expected tool execution content blocks')
  }

  const block = completedContent.find(
    (contentBlock) => contentBlock.type === 'tool_execution',
  )
  assert.equal(block?.type, 'tool_execution')
  if (block?.type === 'tool_execution') {
    assert.equal(block.status, 'complete')
    assert.equal(block.summary, 'Done')
    assert.deepEqual(block.data, { rows: 1 })
    assert.equal(block.timeline?.length, 2)
  }
})

test('chatMessageReducer completes, errors, and clears messages', () => {
  const state = { ...baseChatData, messages: [{ ...userMessage, content: '' }] }
  const completed = chatMessageReducer(state, {
    type: 'complete_message',
    messageId: 'user-message-1',
    content: 'Done',
    timestamp: '2026-01-01T00:00:02.000Z',
  })

  assert.equal(completed.messages[0]?.content, 'Done')
  assert.equal(completed.messages[0]?.status, 'complete')

  const errored = chatMessageReducer(completed, {
    type: 'set_message_error',
    messageId: 'user-message-1',
    timestamp: '2026-01-01T00:00:03.000Z',
  })

  assert.equal(errored.messages[0]?.status, 'error')

  const cleared = chatMessageReducer(errored, {
    type: 'clear_conversation',
    timestamp: '2026-01-01T00:00:04.000Z',
  })

  assert.deepEqual(cleared.messages, [])
  assert.equal(cleared.updatedAt, '2026-01-01T00:00:04.000Z')
})
