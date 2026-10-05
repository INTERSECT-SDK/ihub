import {
  ChatContentBlock,
  ChatData,
  ChatMessage,
  ChatParticipant,
  ChatToolExecutionTimelineEntry,
} from '@ihub/utils/types/chat'

import { toBlocks } from './chat-migrations'

type ToolExecutionBlock = Extract<ChatContentBlock, { type: 'tool_execution' }>

/**
 * Incremental update for a tool execution block.
 *
 * `toolName` is required because socket progress and result events may be the
 * first event seen for a tool call, while `timelineEntry` records the event that
 * caused this patch.
 */
export type ToolExecutionPatch = Partial<ToolExecutionBlock> & {
  toolName: string
  timelineEntry?: ChatToolExecutionTimelineEntry
}

/**
 * Reducer actions for all chat state mutations owned by the message layer.
 *
 * Each state-changing action receives an explicit timestamp so callers can
 * preserve event timestamps where required and update `ChatData.updatedAt`
 * consistently for local mutations.
 */
export type ChatMessageAction =
  | {
      type: 'append_user_message'
      message: ChatMessage
      timestamp: string
    }
  | {
      type: 'ensure_assistant_message'
      messageId: string
      senderId: string
      timestamp: string
    }
  | {
      type: 'update_message'
      messageId: string
      updater: (message: ChatMessage) => ChatMessage
      timestamp: string
    }
  | {
      type: 'append_block'
      messageId: string
      block: ChatContentBlock
      timestamp: string
    }
  | {
      type: 'append_delta'
      messageId: string
      delta: string
      timestamp: string
    }
  | {
      type: 'complete_message'
      messageId: string
      content: string
      timestamp: string
    }
  | {
      type: 'set_message_error'
      messageId: string
      timestamp: string
    }
  | {
      type: 'upsert_tool_execution'
      messageId: string
      toolCallId: string
      patch: ToolExecutionPatch
      timestamp: string
    }
  | {
      type: 'clear_conversation'
      timestamp: string
    }
  | {
      type: 'set_participants'
      participants: ChatParticipant[]
    }

/**
 * Applies a targeted message transformation and updates chat modification time.
 *
 * If the message id is absent the state is still returned with a refreshed
 * `updatedAt`, matching the previous component-level update behavior.
 */
function updateMessage(
  state: ChatData,
  messageId: string,
  updater: (message: ChatMessage) => ChatMessage,
  timestamp: string,
): ChatData {
  return {
    ...state,
    messages: state.messages.map((message) =>
      message.id === messageId ? updater(message) : message,
    ),
    updatedAt: timestamp,
  }
}

/**
 * Adds or updates the tool execution block for a websocket tool event.
 *
 * Existing legacy `progress` or `tool_result` blocks are folded into the current
 * `tool_execution` shape before applying the new patch, which keeps reducers
 * compatible with migrated and partially migrated message content.
 */
function upsertToolExecutionBlock(
  message: ChatMessage,
  toolCallId: string,
  patch: ToolExecutionPatch,
): ChatMessage {
  const blocks = toBlocks(message.content)
  const blockIndex = blocks.findIndex(
    (block) =>
      (block.type === 'tool_execution' && block.toolCallId === toolCallId) ||
      (block.type === 'progress' && block.toolCallId === toolCallId) ||
      (block.type === 'tool_result' && block.toolCallId === toolCallId),
  )

  const existingBlock = blockIndex >= 0 ? blocks[blockIndex] : null
  let existingToolExecution: Partial<ToolExecutionBlock> = {}

  if (existingBlock?.type === 'tool_execution') {
    existingToolExecution = existingBlock
  } else if (existingBlock?.type === 'progress') {
    existingToolExecution = {
      toolCallId: existingBlock.toolCallId || toolCallId,
      toolName: existingBlock.label,
      label: existingBlock.label,
      value: existingBlock.value,
      max: existingBlock.max,
      detail: existingBlock.detail,
      status: existingBlock.status,
    }
  } else if (existingBlock?.type === 'tool_result') {
    existingToolExecution = {
      toolCallId: existingBlock.toolCallId || toolCallId,
      toolName: existingBlock.toolName,
      label: existingBlock.toolName,
      summary: existingBlock.summary,
      data: existingBlock.data,
      displayHint: existingBlock.displayHint,
      status: 'complete',
    }
  }

  const nextBlock: ToolExecutionBlock = {
    ...existingToolExecution,
    type: 'tool_execution',
    toolCallId,
    toolName: patch.toolName,
    label: patch.label || existingToolExecution.label || patch.toolName,
    value: patch.value,
    max: patch.max,
    detail: patch.detail,
    status: patch.status || existingToolExecution.status,
    summary: patch.summary,
    data: patch.data,
    displayHint: patch.displayHint,
    startedAt: patch.startedAt || existingToolExecution.startedAt,
    completedAt: patch.completedAt || existingToolExecution.completedAt,
    timeline: [
      ...(existingToolExecution.timeline || []),
      ...(patch.timelineEntry ? [patch.timelineEntry] : []),
    ],
  }

  if (blockIndex >= 0) {
    blocks[blockIndex] = nextBlock
  } else {
    blocks.push(nextBlock)
  }

  return {
    ...message,
    content: blocks,
    messageType: 'rich',
    status: 'streaming',
  }
}

/**
 * Pure reducer for chat message, participant, and rich content state changes.
 *
 * The reducer intentionally avoids websocket or React concerns so migration,
 * streaming, prompt, visualization, error, and clear behavior can be tested as
 * deterministic state transitions.
 */
export function chatMessageReducer(
  state: ChatData,
  action: ChatMessageAction,
): ChatData {
  switch (action.type) {
    case 'append_user_message':
      return {
        ...state,
        messages: [...state.messages, action.message],
        updatedAt: action.timestamp,
      }

    case 'ensure_assistant_message': {
      const existingMessage = state.messages.find(
        (message) => message.id === action.messageId,
      )
      if (existingMessage) {
        return state
      }

      const assistantMessage: ChatMessage = {
        id: action.messageId,
        senderId: action.senderId,
        content: '',
        timestamp: action.timestamp,
        messageType: 'text',
        status: 'streaming',
        display: true,
        flowcept: false,
      }

      return {
        ...state,
        messages: [...state.messages, assistantMessage],
        updatedAt: action.timestamp,
      }
    }

    case 'update_message':
      return updateMessage(
        state,
        action.messageId,
        action.updater,
        action.timestamp,
      )

    case 'append_block':
      return updateMessage(
        state,
        action.messageId,
        (message) => ({
          ...message,
          content: [...toBlocks(message.content), action.block],
          messageType: 'rich',
          status:
            action.block.type === 'prompt'
              ? 'awaiting_input'
              : message.status === 'error'
                ? 'error'
                : 'streaming',
        }),
        action.timestamp,
      )

    case 'append_delta':
      return updateMessage(
        state,
        action.messageId,
        (message) => {
          if (Array.isArray(message.content)) {
            const blocks = [...message.content]
            const lastBlock = blocks.at(-1)

            if (lastBlock?.type === 'markdown') {
              blocks[blocks.length - 1] = {
                ...lastBlock,
                text: `${lastBlock.text}${action.delta}`,
              }
            } else {
              blocks.push({
                type: 'markdown',
                text: action.delta,
              })
            }

            return {
              ...message,
              content: blocks,
              messageType: 'rich',
              status: 'streaming',
            }
          }

          return {
            ...message,
            content: `${String(message.content || '')}${action.delta}`,
            messageType: 'text',
            status: 'streaming',
          }
        },
        action.timestamp,
      )

    case 'complete_message':
      return updateMessage(
        state,
        action.messageId,
        (message) => {
          const isEmptyText =
            !Array.isArray(message.content) && !String(message.content).trim()

          return {
            ...message,
            content: isEmptyText ? action.content : message.content,
            status: 'complete',
          }
        },
        action.timestamp,
      )

    case 'set_message_error':
      return updateMessage(
        state,
        action.messageId,
        (message) => ({
          ...message,
          status: 'error',
        }),
        action.timestamp,
      )

    case 'upsert_tool_execution':
      return updateMessage(
        state,
        action.messageId,
        (message) =>
          upsertToolExecutionBlock(message, action.toolCallId, action.patch),
        action.timestamp,
      )

    case 'clear_conversation':
      return {
        ...state,
        messages: [],
        updatedAt: action.timestamp,
      }

    case 'set_participants':
      return {
        ...state,
        participants: action.participants,
      }
  }
}
