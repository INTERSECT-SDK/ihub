import {
  ChatSocketClientEvent,
  ChatSocketServerEvent,
} from '@ihub/utils/types/chat'

type ChatSocketHandlers = {
  onEvent: (event: ChatSocketServerEvent) => void
  onOpen?: () => void
  onClose?: (event: CloseEvent) => void
  onError?: () => void
}

export function buildChatWebSocketUrl(agentId: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/api/v1/chat/ws/${encodeURIComponent(agentId)}`
}

export function connectChatSocket(
  agentId: string,
  handlers: ChatSocketHandlers,
): WebSocket {
  const socket = new WebSocket(buildChatWebSocketUrl(agentId))

  socket.addEventListener('open', () => {
    handlers.onOpen?.()
  })

  socket.addEventListener('message', (messageEvent) => {
    try {
      if (typeof messageEvent.data !== 'string') {
        return
      }

      const parsed = JSON.parse(messageEvent.data) as ChatSocketServerEvent
      handlers.onEvent(parsed)
    } catch (error) {
      console.error('Failed to parse chat websocket event', error)
    }
  })

  socket.addEventListener('close', (event) => {
    handlers.onClose?.(event)
  })

  socket.addEventListener('error', () => {
    handlers.onError?.()
  })

  return socket
}

export function sendChatSocketEvent(
  socket: WebSocket | null,
  event: ChatSocketClientEvent,
): boolean {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return false
  }

  socket.send(JSON.stringify(event))
  return true
}
