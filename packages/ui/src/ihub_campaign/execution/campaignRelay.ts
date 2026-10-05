import type { CampaignRelayEvent } from './events'

const RELAY_SOCKET_CONNECTING = 0
const RELAY_SOCKET_OPEN = 1

type RelaySocket = {
  readyState: number
  onopen: ((event: Event) => void) | null
  onmessage: ((event: MessageEvent) => void) | null
  onerror: ((event: Event) => void) | null
  onclose: ((event: CloseEvent) => void) | null
  close: () => void
}

type CampaignRelayDependencies = {
  createSocket: (url: string) => RelaySocket
  parsePayload: (data: unknown) => CampaignRelayEvent | null
  isReadyMessage: (event: CampaignRelayEvent) => boolean
  setTimer?: (callback: () => void, delay: number) => unknown
  clearTimer?: (timer: unknown) => void
  readinessTimeoutMs?: number
}

export type CampaignRelay = {
  connect: (url: string) => Promise<void>
  isOpen: () => boolean
  activate: (onEvent: (event: CampaignRelayEvent) => void) => void
  close: () => void
}

/** Creates a campaign relay transport with readiness and buffering semantics. */
export function createCampaignRelay({
  createSocket,
  parsePayload,
  isReadyMessage,
  setTimer = (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimer = (timer) =>
    globalThis.clearTimeout(timer as ReturnType<typeof globalThis.setTimeout>),
  readinessTimeoutMs = 15000,
}: CampaignRelayDependencies): CampaignRelay {
  let socket: RelaySocket | null = null
  let readinessTimer: unknown = null
  let rejectReadiness: ((error: Error) => void) | null = null
  let onEvent: ((event: CampaignRelayEvent) => void) | null = null
  let bufferedEvents: CampaignRelayEvent[] = []

  const clearReadiness = () => {
    if (readinessTimer !== null) {
      clearTimer(readinessTimer)
      readinessTimer = null
    }
    rejectReadiness = null
  }

  const close = () => {
    const targetSocket = socket
    const pendingReject = rejectReadiness
    clearReadiness()
    bufferedEvents = []
    onEvent = null
    if (!targetSocket) {
      return
    }

    targetSocket.onopen = null
    targetSocket.onmessage = null
    targetSocket.onerror = null
    targetSocket.onclose = null
    if (
      targetSocket.readyState === RELAY_SOCKET_CONNECTING ||
      targetSocket.readyState === RELAY_SOCKET_OPEN
    ) {
      targetSocket.close()
    }
    if (socket === targetSocket) {
      socket = null
    }
    pendingReject?.(
      new Error('Campaign relay websocket closed before readiness'),
    )
  }

  const connect = (url: string): Promise<void> => {
    close()
    const nextSocket = createSocket(url)
    socket = nextSocket
    bufferedEvents = []
    onEvent = null

    return new Promise<void>((resolve, reject) => {
      let readinessSettled = false
      const resolveReady = () => {
        if (readinessSettled) return
        readinessSettled = true
        clearReadiness()
        resolve()
      }
      const rejectReady = (error: Error) => {
        if (readinessSettled) return
        readinessSettled = true
        clearReadiness()
        reject(error)
      }

      rejectReadiness = rejectReady
      readinessTimer = setTimer(() => {
        rejectReady(new Error('Timed out waiting for campaign relay readiness'))
      }, readinessTimeoutMs)
      nextSocket.onopen = () => {}
      nextSocket.onmessage = (message) => {
        console.log('[Campaign] Relay raw message', message.data)
        const relayEvent = parsePayload(message.data)
        if (!relayEvent) {
          console.log(
            '[Campaign] Relay message ignored (non-JSON object payload)',
          )
          return
        }
        if (isReadyMessage(relayEvent)) {
          console.log('[Campaign] Relay ready message', relayEvent)
          resolveReady()
          return
        }
        if (onEvent) onEvent(relayEvent)
        else bufferedEvents.push(relayEvent)
      }
      nextSocket.onerror = () => {
        rejectReady(new Error('Campaign relay websocket error'))
      }
      nextSocket.onclose = () => {
        if (socket === nextSocket) socket = null
        rejectReady(
          new Error('Campaign relay websocket closed before readiness'),
        )
      }
    })
  }

  const activate = (handler: (event: CampaignRelayEvent) => void) => {
    onEvent = handler
    const eventsToReplay = bufferedEvents
    bufferedEvents = []
    eventsToReplay.forEach(handler)
  }

  const isOpen = () => socket?.readyState === RELAY_SOCKET_OPEN

  return { connect, isOpen, activate, close }
}

/** Returns the cleanup callback registered by the relay hook on unmount. */
export function createCampaignRelayUnmountCleanup(relay: CampaignRelay) {
  return () => relay.close()
}
