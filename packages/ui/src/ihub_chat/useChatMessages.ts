'use client'

import {
  ChatContentBlock,
  ChatData,
  ChatMessage,
  ChatParticipant,
} from '@ihub/utils/types/chat'
import { UserProfile } from '@ihub/utils/types/types'
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react'

import { ToolExecutionPatch, chatMessageReducer } from './chat-message-reducer'
import { createUserMessage, migrateChatData } from './chat-migrations'

type UseChatMessagesOptions = {
  chatData: ChatData
  currentUser: UserProfile
  setDocumentContent?: (
    chatData: ChatData,
    options?: { dirty?: boolean },
  ) => void
}

/**
 * Owns migrated chat state and reducer-backed message mutation helpers.
 *
 * The hook inserts the current user participant when needed, mirrors every chat
 * state change to `setDocumentContent`, and exposes stable operations for the
 * socket and rendering layers without leaking reducer actions into `Chat.tsx`.
 */
export function useChatMessages({
  chatData,
  currentUser,
  setDocumentContent,
}: UseChatMessagesOptions) {
  const [chatDataState, dispatch] = useReducer(
    chatMessageReducer,
    chatData,
    migrateChatData,
  )
  const setDocumentContentRef = useRef(setDocumentContent)
  const hasPublishedInitialStateRef = useRef(false)

  useEffect(() => {
    setDocumentContentRef.current = setDocumentContent
  }, [setDocumentContent])

  useEffect(() => {
    setDocumentContentRef.current?.(chatDataState, {
      dirty: hasPublishedInitialStateRef.current,
    })
    hasPublishedInitialStateRef.current = true
  }, [chatDataState])

  useEffect(() => {
    const userParticipant = chatDataState.participants.find(
      (participant) => participant.userId === currentUser.id,
    )
    if (userParticipant) {
      return
    }

    const newParticipant: ChatParticipant = {
      userId: currentUser.id,
      userName: `${currentUser.firstName} ${currentUser.lastName}`,
      userRole: 'user',
    }

    dispatch({
      type: 'set_participants',
      participants: [...chatDataState.participants, newParticipant],
    })
  }, [
    chatDataState.participants,
    currentUser.firstName,
    currentUser.id,
    currentUser.lastName,
  ])

  const userLookup = useMemo(() => {
    const lookup: Record<string, ChatParticipant> = {}
    chatDataState.participants.forEach((participant) => {
      lookup[participant.userId] = participant
    })
    return lookup
  }, [chatDataState.participants])

  /**
   * Appends a complete local user message and returns it for socket history.
   */
  const appendUserMessage = useCallback(
    (
      content: string,
      attachments: Extract<ChatContentBlock, { type: 'attachment' }>[] = [],
    ) => {
      const message = createUserMessage(currentUser.id, content, attachments)
      dispatch({
        type: 'append_user_message',
        message,
        timestamp: new Date().toISOString(),
      })
      return message
    },
    [currentUser.id],
  )

  /**
   * Ensures an assistant message exists before streaming or rich blocks arrive.
   */
  const ensureAssistantMessage = useCallback(
    (messageId: string, senderId: string, timestamp: string) => {
      dispatch({
        type: 'ensure_assistant_message',
        messageId,
        senderId,
        timestamp,
      })
    },
    [],
  )

  /**
   * Applies a custom transformation to a message through the reducer boundary.
   */
  const updateMessage = useCallback(
    (messageId: string, updater: (message: ChatMessage) => ChatMessage) => {
      dispatch({
        type: 'update_message',
        messageId,
        updater,
        timestamp: new Date().toISOString(),
      })
    },
    [],
  )

  /**
   * Appends a rich content block and updates message status for prompt waits.
   */
  const appendBlock = useCallback(
    (messageId: string, block: ChatContentBlock) => {
      dispatch({
        type: 'append_block',
        messageId,
        block,
        timestamp: new Date().toISOString(),
      })
    },
    [],
  )

  /**
   * Appends streamed text to a text message or the trailing markdown block.
   */
  const appendDelta = useCallback((messageId: string, delta: string) => {
    dispatch({
      type: 'append_delta',
      messageId,
      delta,
      timestamp: new Date().toISOString(),
    })
  }, [])

  /**
   * Marks a message complete, filling empty text content from the final event.
   */
  const completeMessage = useCallback((messageId: string, content: string) => {
    dispatch({
      type: 'complete_message',
      messageId,
      content,
      timestamp: new Date().toISOString(),
    })
  }, [])

  /**
   * Marks a message as failed after an agent or websocket error event.
   */
  const markMessageError = useCallback((messageId: string) => {
    dispatch({
      type: 'set_message_error',
      messageId,
      timestamp: new Date().toISOString(),
    })
  }, [])

  /**
   * Upserts a tool execution block while preserving prior timeline entries.
   */
  const upsertToolExecution = useCallback(
    (messageId: string, toolCallId: string, patch: ToolExecutionPatch) => {
      dispatch({
        type: 'upsert_tool_execution',
        messageId,
        toolCallId,
        patch,
        timestamp: new Date().toISOString(),
      })
    },
    [],
  )

  /**
   * Clears all messages while preserving chat metadata and participants.
   */
  const clearMessages = useCallback(() => {
    dispatch({
      type: 'clear_conversation',
      timestamp: new Date().toISOString(),
    })
  }, [])

  /**
   * Replaces chat participants after user or agent membership changes.
   */
  const setParticipants = useCallback((participants: ChatParticipant[]) => {
    dispatch({
      type: 'set_participants',
      participants,
    })
  }, [])

  return {
    chatDataState,
    userLookup,
    appendUserMessage,
    ensureAssistantMessage,
    updateMessage,
    appendBlock,
    appendDelta,
    completeMessage,
    markMessageError,
    upsertToolExecution,
    clearMessages,
    setParticipants,
  }
}
