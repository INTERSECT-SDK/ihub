/* eslint-disable @typescript-eslint/no-require-imports -- Node loads the sibling TS helper directly. */
const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')

const { createCampaignRelay, createCampaignRelayUnmountCleanup } =
  require('./campaignRelay.ts') as typeof import('./campaignRelay')

class MockRelaySocket {
  readyState = 0
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  closeCount = 0

  close() {
    this.closeCount += 1
    this.readyState = 3
  }

  emit(data: unknown) {
    this.onmessage?.({ data } as MessageEvent)
  }
}

function createHarness() {
  const sockets: MockRelaySocket[] = []
  const timers = new Map<number, () => void>()
  let nextTimer = 1
  const relay = createCampaignRelay({
    createSocket: () => {
      const socket = new MockRelaySocket()
      sockets.push(socket)
      return socket
    },
    setTimer: (callback) => {
      const timer = nextTimer++
      timers.set(timer, callback)
      return timer
    },
    clearTimer: (timer) => timers.delete(timer as number),
    parsePayload: (data) => {
      if (typeof data !== 'string') return null
      const parsed = JSON.parse(data)
      return parsed && typeof parsed === 'object' ? parsed : null
    },
    isReadyMessage: (event) => event.message_type === 'relay_ready',
  })
  return { relay, sockets, timers }
}

const readyMessage = JSON.stringify({
  message_type: 'relay_ready',
  broker_id: 7,
})

test('connect waits for relay readiness and clears its timeout', async () => {
  const { relay, sockets, timers } = createHarness()
  const connected = relay.connect('ws://relay')
  sockets[0]!.readyState = 1
  sockets[0]!.emit(readyMessage)

  await connected
  assert.equal(timers.size, 0)
  assert.equal(relay.isOpen(), true)
})

test('isOpen detects a relay that closes after reporting readiness', async () => {
  const { relay, sockets } = createHarness()
  assert.equal(relay.isOpen(), false)

  const connected = relay.connect('ws://relay')
  assert.equal(relay.isOpen(), false)

  sockets[0]!.readyState = 1
  sockets[0]!.emit(readyMessage)
  sockets[0]!.readyState = 2

  await connected
  assert.equal(relay.isOpen(), false)

  sockets[0]!.readyState = 3
  sockets[0]!.onclose?.({} as CloseEvent)
  assert.equal(relay.isOpen(), false)
})

test('activate replays pre-activation events in order then forwards live events', async () => {
  const { relay, sockets } = createHarness()
  const connected = relay.connect('ws://relay')
  sockets[0]!.readyState = 1
  sockets[0]!.emit(JSON.stringify({ sequence: 1 }))
  sockets[0]!.emit(JSON.stringify({ sequence: 2 }))
  sockets[0]!.emit(readyMessage)
  await connected

  const sequences: unknown[] = []
  relay.activate((event) => sequences.push(event.sequence))
  sockets[0]!.emit(JSON.stringify({ sequence: 3 }))

  assert.deepEqual(sequences, [1, 2, 3])
})

test('connect rejects on timeout and websocket errors', async () => {
  const timeoutHarness = createHarness()
  const timedOut = timeoutHarness.relay.connect('ws://relay')
  ;[...timeoutHarness.timers.values()][0]!()
  await assert.rejects(timedOut, /Timed out/)

  const errorHarness = createHarness()
  const errored = errorHarness.relay.connect('ws://relay')
  errorHarness.sockets[0]!.onerror?.(new Event('error'))
  await assert.rejects(errored, /websocket error/)
})

test('replacement detaches and closes the previous socket', async () => {
  const { relay, sockets } = createHarness()
  const firstConnect = relay.connect('ws://first')
  const firstSocket = sockets[0]!
  const secondConnect = relay.connect('ws://second')

  await assert.rejects(firstConnect, /closed before readiness/)
  assert.equal(firstSocket.closeCount, 1)
  assert.equal(firstSocket.onmessage, null)
  sockets[1]!.readyState = 1
  sockets[1]!.emit(readyMessage)
  await secondConnect
})

test('close clears buffers, handlers, timers, and closes open sockets', async () => {
  const { relay, sockets, timers } = createHarness()
  const connected = relay.connect('ws://relay')
  sockets[0]!.readyState = 1
  sockets[0]!.emit(readyMessage)
  await connected
  sockets[0]!.emit(JSON.stringify({ sequence: 1 }))

  relay.close()

  assert.equal(timers.size, 0)
  assert.equal(relay.isOpen(), false)
  assert.equal(sockets[0]!.closeCount, 1)
  assert.equal(sockets[0]!.onmessage, null)
  const sequences: unknown[] = []
  relay.activate((event) => sequences.push(event.sequence))
  assert.deepEqual(sequences, [])
})

test('unmount cleanup closes the relay', () => {
  let closeCount = 0
  const cleanup = createCampaignRelayUnmountCleanup({
    connect: async () => {},
    isOpen: () => false,
    activate: () => {},
    close: () => {
      closeCount += 1
    },
  })

  cleanup()
  assert.equal(closeCount, 1)
})
