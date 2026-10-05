/* eslint-disable @typescript-eslint/no-require-imports -- Node's direct TS test runner needs require() for the notebook helper. */
const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')

const { fetchKernelVariableValue } =
  require('../../ihub_notebook/fetchKernelValue.ts') as typeof import('../../ihub_notebook/fetchKernelValue')

type SocketListener = (event: Event | MessageEvent) => void

class MockKernelSocket {
  readonly sentMessages: string[] = []
  private readonly listeners = new Map<string, Set<SocketListener>>()

  addEventListener(type: string, listener: SocketListener) {
    const listeners = this.listeners.get(type) ?? new Set<SocketListener>()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type: string, listener: SocketListener) {
    this.listeners.get(type)?.delete(listener)
  }

  send(message: string) {
    this.sentMessages.push(message)
  }

  emit(type: string, event: Event | MessageEvent = new Event(type)) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener(event)
    }
  }

  listenerCount(type: string) {
    return this.listeners.get(type)?.size ?? 0
  }
}

function getRequestMessageId(socket: MockKernelSocket): string {
  const request = JSON.parse(socket.sentMessages[0]!) as {
    header: { msg_id: string }
  }
  return request.header.msg_id
}

function emitKernelResponse(socket: MockKernelSocket, content: unknown): void {
  socket.emit(
    'message',
    new MessageEvent('message', {
      data: JSON.stringify({
        parent_header: { msg_id: getRequestMessageId(socket) },
        msg_type: 'stream',
        content: { text: JSON.stringify(content) },
      }),
    }),
  )
}

function emitRawKernelMessage(socket: MockKernelSocket, data: unknown): void {
  socket.emit('message', new MessageEvent('message', { data }))
}

function assertSocketCleanedUp(socket: MockKernelSocket): void {
  assert.equal(socket.listenerCount('message'), 0)
  assert.equal(socket.listenerCount('close'), 0)
  assert.equal(socket.listenerCount('error'), 0)
}

test('kernel JSON null resolves and cleans up all listeners', async () => {
  const socket = new MockKernelSocket()
  const result = fetchKernelVariableValue(
    socket as unknown as WebSocket,
    'kernel-1',
    'value',
  )

  emitKernelResponse(socket, null)

  assert.equal(await result, null)
  assertSocketCleanedUp(socket)
})

test('Unicode Python identifiers resolve through globals lookup', async () => {
  for (const variableName of ['café', 'δ']) {
    const socket = new MockKernelSocket()
    const result = fetchKernelVariableValue(
      socket as unknown as WebSocket,
      'kernel-1',
      variableName,
    )
    const request = JSON.parse(socket.sentMessages[0]!) as {
      content: { code: string }
    }

    assert.ok(
      request.content.code.includes(
        `variable_name = ${JSON.stringify(variableName)}`,
      ),
    )
    assert.match(request.content.code, /globals\(\)\[variable_name\]/)

    emitKernelResponse(socket, variableName)
    assert.equal(await result, variableName)
    assertSocketCleanedUp(socket)
  }
})

test('code-like variable names remain safely encoded as globals lookup data', async () => {
  const socket = new MockKernelSocket()
  const variableName = 'value; raise Exception("boom")'
  const result = fetchKernelVariableValue(
    socket as unknown as WebSocket,
    'kernel-1',
    variableName,
  )
  const request = JSON.parse(socket.sentMessages[0]!) as {
    content: { code: string }
  }

  assert.ok(
    request.content.code.includes(
      `variable_name = ${JSON.stringify(variableName)}`,
    ),
  )
  assert.match(request.content.code, /globals\(\)\[variable_name\]/)
  assert.doesNotMatch(
    request.content.code,
    /json\.dumps\(value; raise Exception/,
  )

  emitKernelResponse(socket, 42)
  assert.equal(await result, 42)
})

test('unrelated malformed and unmatched traffic is ignored', async () => {
  const socket = new MockKernelSocket()
  const result = fetchKernelVariableValue(
    socket as unknown as WebSocket,
    'kernel-1',
    'value',
  )

  emitRawKernelMessage(socket, 'not json')
  emitRawKernelMessage(socket, new Uint8Array([1, 2, 3]).buffer)
  emitRawKernelMessage(socket, JSON.stringify(42))
  emitRawKernelMessage(socket, JSON.stringify(['unexpected']))
  emitRawKernelMessage(
    socket,
    JSON.stringify({
      parent_header: { msg_id: 'another-request' },
      msg_type: 'stream',
      content: { text: 'not json' },
    }),
  )

  assert.equal(socket.listenerCount('message'), 1)
  emitKernelResponse(socket, { ready: true })

  assert.deepEqual(await result, { ready: true })
  assertSocketCleanedUp(socket)
})

test('malformed correlated stream content rejects and cleans up', async () => {
  const socket = new MockKernelSocket()
  const result = fetchKernelVariableValue(
    socket as unknown as WebSocket,
    'kernel-1',
    'value',
  )

  emitRawKernelMessage(
    socket,
    JSON.stringify({
      parent_header: { msg_id: getRequestMessageId(socket) },
      msg_type: 'stream',
      content: { text: 'not json' },
    }),
  )

  await assert.rejects(result, SyntaxError)
  assertSocketCleanedUp(socket)
})

test('matching kernel error envelope rejects exactly once and cleans up', async () => {
  const socket = new MockKernelSocket()
  const result = fetchKernelVariableValue(
    socket as unknown as WebSocket,
    'kernel-1',
    'value',
  )

  emitKernelResponse(socket, { __error__: 'lookup failed' })
  socket.emit('close')

  await assert.rejects(result, /lookup failed/)
  assertSocketCleanedUp(socket)
})

test('kernel socket close and error reject and remove all listeners', async () => {
  for (const eventType of ['close', 'error']) {
    const socket = new MockKernelSocket()
    const result = fetchKernelVariableValue(
      socket as unknown as WebSocket,
      'kernel-1',
      'value',
    )

    socket.emit(eventType)

    await assert.rejects(result, /websocket/)
    assertSocketCleanedUp(socket)
  }
})

test('kernel send failures reject and remove all listeners', async () => {
  const socket = new MockKernelSocket()
  socket.send = () => {
    throw new Error('socket is not open')
  }

  await assert.rejects(
    fetchKernelVariableValue(
      socket as unknown as WebSocket,
      'kernel-1',
      'value',
    ),
    /socket is not open/,
  )
  assertSocketCleanedUp(socket)
})

test('kernel lookup times out after 15 seconds and settles only once', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const socket = new MockKernelSocket()
  const result = fetchKernelVariableValue(
    socket as unknown as WebSocket,
    'kernel-1',
    'value',
  )

  t.mock.timers.tick(14999)
  assert.equal(socket.listenerCount('message'), 1)
  t.mock.timers.tick(1)
  emitKernelResponse(socket, 42)

  await assert.rejects(result, /Timed out/)
  assertSocketCleanedUp(socket)
})
