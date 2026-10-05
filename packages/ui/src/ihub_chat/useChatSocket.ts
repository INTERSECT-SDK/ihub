'use client'

import {
  ChatContentBlock,
  ChatSocketClientEvent,
  ChatSocketServerEvent,
} from '@ihub/utils/types/chat'
import { useEffect, useEffectEvent, useRef, useState } from 'react'

import { ToolExecutionPatch } from './chat-message-reducer'
import { connectChatSocket, sendChatSocketEvent } from './chat-utils'
import { ChatAgentSelection } from './useChatAgents'
import {
  deriveVisualizationBlock,
  normalizeToolResultImages,
} from './chat-migrations'

type SocketState = 'disconnected' | 'connecting' | 'connected'

type UseChatSocketOptions = {
  selectedAgent: ChatAgentSelection | null
  roomConfigured: boolean
  conversationId: string
  canUseGroupChat: boolean
  selectedPrimaryAgentId: string | null
  selectedGroupAgentIds: string[]
  startAgentProcessing: () => void
  stopAgentProcessing: () => void
  ensureAssistantMessage: (
    messageId: string,
    senderId: string,
    timestamp: string,
  ) => void
  appendBlock: (messageId: string, block: ChatContentBlock) => void
  appendDelta: (messageId: string, delta: string) => void
  completeMessage: (messageId: string, content: string) => void
  markMessageError: (messageId: string) => void
  upsertToolExecution: (
    messageId: string,
    toolCallId: string,
    patch: ToolExecutionPatch,
  ) => void
  clearMessages: () => void
}

/**
 * Owns chat websocket lifecycle, outbound queueing, and incoming event routing.
 *
 * The hook preserves the existing protocol while isolating connection setup,
 * reconnect backoff, unauthorized-close handling, session start delivery, and
 * streaming delta timers from the rendered chat component.
 */
export function useChatSocket({
  selectedAgent,
  roomConfigured,
  conversationId,
  canUseGroupChat,
  selectedPrimaryAgentId,
  selectedGroupAgentIds,
  startAgentProcessing,
  stopAgentProcessing,
  ensureAssistantMessage,
  appendBlock,
  appendDelta,
  completeMessage,
  markMessageError,
  upsertToolExecution,
  clearMessages,
}: UseChatSocketOptions) {
  const [agentError, setAgentError] = useState<string | null>(null)
  const [socketState, setSocketState] = useState<SocketState>('disconnected')
  const [connectTick, setConnectTick] = useState(0)
  const socketRef = useRef<WebSocket | null>(null)
  const pendingSocketEventsRef = useRef<ChatSocketClientEvent[]>([])
  const reconnectAttemptsRef = useRef(0)
  const reconnectTimerRef = useRef<number | null>(null)
  const shouldReconnectRef = useRef(false)
  const deltaBufferRef = useRef<Record<string, string>>({})
  const deltaTimerRef = useRef<Record<string, number | null>>({})

  useEffect(() => {
    shouldReconnectRef.current = roomConfigured && !!selectedAgent?.id
    if (!shouldReconnectRef.current && reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
  }, [roomConfigured, selectedAgent?.id])

  /**
   * Builds the session start payload for the currently configured room.
   */
  const buildSessionStartEvent = useEffectEvent(
    (): ChatSocketClientEvent | null => {
      if (!selectedAgent?.id || !roomConfigured) {
        return null
      }

      return {
        type: 'session.start',
        conversationId,
        supervisorAgentId: canUseGroupChat ? selectedPrimaryAgentId : undefined,
        participantAgentIds: canUseGroupChat
          ? selectedGroupAgentIds
          : undefined,
      }
    },
  )

  /**
   * Sends any queued outbound events once the websocket is open.
   */
  const flushPendingSocketEvents = useEffectEvent(() => {
    const socket = socketRef.current
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return
    }

    const queuedEvents = [...pendingSocketEventsRef.current]
    pendingSocketEventsRef.current = []

    queuedEvents.forEach((event) => {
      sendChatSocketEvent(socket, event)
    })
  })

  /**
   * Sends an outbound event immediately or queues it until the socket opens.
   */
  const sendOrQueueSocketEvent = useEffectEvent(
    (event: ChatSocketClientEvent) => {
      const sent = sendChatSocketEvent(socketRef.current, event)
      if (sent) {
        return
      }

      pendingSocketEventsRef.current.push(event)
    },
  )

  /**
   * Gradually drains buffered streaming text for smoother assistant rendering.
   */
  const pumpDelta = useEffectEvent((messageId: string) => {
    const currentBuffer = deltaBufferRef.current[messageId] || ''
    if (!currentBuffer) {
      deltaTimerRef.current[messageId] = null
      return
    }

    const chunkSize = Math.max(
      1,
      Math.min(4, Math.ceil(currentBuffer.length / 16)),
    )
    const chunk = currentBuffer.slice(0, chunkSize)
    deltaBufferRef.current[messageId] = currentBuffer.slice(chunkSize)
    appendDelta(messageId, chunk)

    deltaTimerRef.current[messageId] = window.setTimeout(() => {
      pumpDelta(messageId)
    }, 16)
  })

  /**
   * Buffers incoming delta text and starts the drain timer when needed.
   */
  const enqueueDelta = useEffectEvent((messageId: string, delta: string) => {
    if (!delta) {
      return
    }

    deltaBufferRef.current[messageId] =
      `${deltaBufferRef.current[messageId] || ''}${delta}`

    if (
      deltaTimerRef.current[messageId] === null ||
      deltaTimerRef.current[messageId] === undefined
    ) {
      pumpDelta(messageId)
    }
  })

  /**
   * Immediately applies any buffered delta text before message completion.
   */
  const flushDeltaBuffer = useEffectEvent((messageId: string) => {
    const timer = deltaTimerRef.current[messageId]
    if (timer !== null && timer !== undefined) {
      window.clearTimeout(timer)
    }

    deltaTimerRef.current[messageId] = null

    const remaining = deltaBufferRef.current[messageId] || ''
    if (remaining) {
      appendDelta(messageId, remaining)
      deltaBufferRef.current[messageId] = ''
    }
  })

  /**
   * Clears all timer and buffered text state for one message id.
   */
  const clearDeltaState = useEffectEvent((messageId: string) => {
    const timer = deltaTimerRef.current[messageId]
    if (timer !== null && timer !== undefined) {
      window.clearTimeout(timer)
    }

    delete deltaTimerRef.current[messageId]
    delete deltaBufferRef.current[messageId]
  })

  /**
   * Clears all streaming delta timers and buffers during teardown or reset.
   */
  const clearAllDeltaState = useEffectEvent(() => {
    Object.values(deltaTimerRef.current).forEach((timer) => {
      if (timer !== null && timer !== undefined) {
        window.clearTimeout(timer)
      }
    })

    deltaTimerRef.current = {}
    deltaBufferRef.current = {}
  })

  /**
   * Routes server websocket events into reducer-backed message operations.
   */
  const handleSocketEvent = useEffectEvent((event: ChatSocketServerEvent) => {
    if (event.type === 'session.ready') {
      setAgentError(null)
      return
    }

    if (event.type === 'conversation.cleared') {
      clearAllDeltaState()
      clearMessages()
      stopAgentProcessing()
      return
    }

    if (event.type === 'message.start') {
      clearDeltaState(event.messageId)
      ensureAssistantMessage(event.messageId, event.senderId, event.timestamp)
      startAgentProcessing()
      return
    }

    if (event.type === 'message.delta') {
      enqueueDelta(event.messageId, event.delta)
      return
    }

    if (event.type === 'message.complete') {
      flushDeltaBuffer(event.messageId)
      completeMessage(event.messageId, event.content)
      clearDeltaState(event.messageId)
      stopAgentProcessing()
      return
    }

    if (event.type === 'tool.start') {
      ensureAssistantMessage(
        event.messageId,
        selectedAgent?.id || event.toolName,
        event.timestamp,
      )
      upsertToolExecution(event.messageId, event.toolCallId, {
        toolName: event.toolName,
        label: event.toolName,
        detail: 'Running tool',
        status: 'running',
        startedAt: event.timestamp,
        timelineEntry: {
          type: 'start',
          at: event.timestamp,
          detail: 'Tool started',
        },
      })
      return
    }

    if (event.type === 'tool.progress') {
      upsertToolExecution(event.messageId, event.toolCallId, {
        toolName: event.label,
        label: event.label,
        value: event.value,
        max: event.max,
        detail: event.detail,
        status: event.status,
        timelineEntry: {
          type: 'progress',
          at: new Date().toISOString(),
          detail: event.detail,
          value: event.value,
          max: event.max,
        },
      })
      return
    }

    if (event.type === 'tool.result') {
      const visualizationBlock = deriveVisualizationBlock(event.result)
      const { compactedResult, imageBlocks } = normalizeToolResultImages(
        event.result,
      )
      const now = new Date().toISOString()
      const hasRenderedResult =
        visualizationBlock !== null || imageBlocks.length > 0

      upsertToolExecution(event.messageId, event.toolCallId, {
        toolName: event.toolName,
        label: event.toolName,
        detail: 'Tool finished',
        status: 'complete',
        summary: hasRenderedResult
          ? event.displayHint ||
            (visualizationBlock ? 'Visualization rendered' : 'Image rendered')
          : event.displayHint || 'Tool output',
        data:
          visualizationBlock && imageBlocks.length === 0
            ? undefined
            : compactedResult,
        displayHint: event.displayHint,
        completedAt: now,
        timelineEntry: {
          type: 'result',
          at: now,
          summary: hasRenderedResult
            ? event.displayHint ||
              (visualizationBlock ? 'Visualization rendered' : 'Image rendered')
            : event.displayHint || 'Tool output',
        },
      })

      if (visualizationBlock) {
        appendBlock(event.messageId, visualizationBlock)
      }
      imageBlocks.forEach((imageBlock) => {
        appendBlock(event.messageId, imageBlock)
      })
      return
    }

    if (event.type === 'prompt.request') {
      appendBlock(event.messageId, event.prompt)
      stopAgentProcessing()
      return
    }

    if (event.type === 'visualization') {
      appendBlock(event.messageId, event.block)
      return
    }

    setAgentError(event.error)
    stopAgentProcessing()

    if (event.messageId) {
      ensureAssistantMessage(
        event.messageId,
        selectedAgent?.id || 'agent',
        new Date().toISOString(),
      )
      appendBlock(event.messageId, {
        type: 'status',
        text: event.error,
        tone: 'error',
      })
      markMessageError(event.messageId)
    }
  })

  /**
   * Handles websocket open by sending session context and queued events.
   */
  const handleSocketOpen = useEffectEvent((socket: WebSocket) => {
    if (socketRef.current !== socket) {
      return
    }

    setSocketState('connected')
    setAgentError(null)
    reconnectAttemptsRef.current = 0

    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }

    const sessionEvent = buildSessionStartEvent()
    if (sessionEvent) {
      sendChatSocketEvent(socket, sessionEvent)
    }

    flushPendingSocketEvents()
  })

  /**
   * Records socket error state without scheduling reconnect by itself.
   */
  const handleSocketError = useEffectEvent(() => {
    setSocketState('disconnected')
    stopAgentProcessing()
  })

  /**
   * Handles normal, unauthorized, and unexpected websocket close behavior.
   */
  const handleSocketClose = useEffectEvent(
    (socket: WebSocket, event: CloseEvent) => {
      if (socketRef.current !== socket) {
        return
      }

      setSocketState('disconnected')
      stopAgentProcessing()

      if (event.code === 1000 || event.code === 1001) {
        return
      }

      if (event.code === 4401) {
        setAgentError('Chat session unauthorized. Please sign in again.')
        return
      }

      if (shouldReconnectRef.current && reconnectTimerRef.current === null) {
        const nextAttempt = reconnectAttemptsRef.current + 1
        reconnectAttemptsRef.current = nextAttempt
        const cappedAttempt = Math.min(nextAttempt, 6)
        const baseDelayMs = Math.min(1000 * 2 ** (cappedAttempt - 1), 15_000)
        const jitterMs = Math.floor(Math.random() * 400)

        reconnectTimerRef.current = window.setTimeout(() => {
          reconnectTimerRef.current = null
          if (!shouldReconnectRef.current) {
            return
          }
          setConnectTick((prev) => prev + 1)
        }, baseDelayMs + jitterMs)

        setSocketState('connecting')
      }

      setAgentError('Chat websocket connection closed unexpectedly.')
    },
  )

  useEffect(() => {
    if (!roomConfigured || !selectedAgent?.id) {
      return
    }

    setSocketState('connecting')
    const socket = connectChatSocket(selectedAgent.id, {
      onOpen: () => {
        handleSocketOpen(socket)
      },
      onEvent: (event) => {
        handleSocketEvent(event)
      },
      onClose: (event) => {
        handleSocketClose(socket, event)
      },
      onError: () => {
        handleSocketError()
      },
    })

    socketRef.current = socket

    return () => {
      clearAllDeltaState()

      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }

      if (socketRef.current === socket) {
        socketRef.current = null
      }
      socket.close()
      setSocketState('disconnected')
    }
    // useEffectEvent handlers are intentionally omitted to avoid reconnecting
    // the websocket on each render when their closure updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectTick, roomConfigured, selectedAgent?.id])

  return {
    agentError,
    setAgentError,
    socketState,
    sendOrQueueSocketEvent,
    clearAllDeltaState,
    buildSessionStartEvent,
  }
}
