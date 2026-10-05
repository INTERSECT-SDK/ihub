/* eslint-disable @typescript-eslint/no-require-imports -- Node's direct TS test runner needs require() for sibling .ts files without changing package module settings. */
const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')

const {
  acceptCodeNodeConnection,
  beginCodeNodeConnectionRequest,
  clearPendingCodeNodeConnection,
  disconnectCodeNodeConnection,
  getCodeNodeConnectionSyncAction,
  hasCodeNodeConnectionOrPending,
  removeCodeNodeConnection,
  trackPendingCodeNodeConnection,
} =
  require('./codeNodeConnectionLifecycle.ts') as typeof import('./codeNodeConnectionLifecycle')

class FakeConnection {
  closeCount = 0

  close() {
    this.closeCount += 1
  }
}

function createLifecycleState() {
  return {
    connections: {} as Record<string, FakeConnection>,
    pendingConnections: {} as Record<string, FakeConnection>,
    pendingConnectionIds: new Set<string>(),
    requestIds: new Map<string, symbol>(),
  }
}

test('pending connection blocks duplicate code-node connection requests', () => {
  const state = createLifecycleState()

  beginCodeNodeConnectionRequest(state, 'code-1')

  assert.equal(hasCodeNodeConnectionOrPending(state, 'code-1'), true)
  assert.equal(state.pendingConnectionIds.has('code-1'), true)
  assert.equal(state.requestIds.has('code-1'), true)
})

test('active open connection refreshes without creating another request', () => {
  const state = createLifecycleState()
  const connection = new FakeConnection()

  state.connections['code-1'] = connection

  assert.equal(
    getCodeNodeConnectionSyncAction(state, 'code-1', (activeConnection) => {
      assert.equal(activeConnection, connection)
      return true
    }),
    'refresh-active',
  )
})

test('active closing connection is not refreshed or reconnected', () => {
  const state = createLifecycleState()
  const connection = new FakeConnection()

  state.connections['code-1'] = connection

  assert.equal(
    getCodeNodeConnectionSyncAction(state, 'code-1', () => false),
    'skip-active',
  )
})

test('pending connection waits instead of creating a duplicate request', () => {
  const state = createLifecycleState()

  beginCodeNodeConnectionRequest(state, 'code-1')

  assert.equal(
    getCodeNodeConnectionSyncAction(state, 'code-1', () => {
      throw new Error('pending nodes should not inspect active sockets')
    }),
    'await-pending',
  )
})

test('missing connection starts a new request path', () => {
  const state = createLifecycleState()

  assert.equal(
    getCodeNodeConnectionSyncAction(state, 'code-1', () => false),
    'connect',
  )
})

test('pending is released when a connection opens, errors, or closes', () => {
  const openState = createLifecycleState()
  const openRequestId = beginCodeNodeConnectionRequest(openState, 'code-1')
  const openConnection = new FakeConnection()

  assert.equal(
    trackPendingCodeNodeConnection(
      openState,
      'code-1',
      openRequestId,
      openConnection,
    ),
    true,
  )
  assert.equal(
    acceptCodeNodeConnection(
      openState,
      'code-1',
      openRequestId,
      openConnection,
    ),
    true,
  )
  assert.equal(openState.pendingConnectionIds.has('code-1'), false)
  assert.equal(openState.pendingConnections['code-1'], undefined)
  assert.equal(openState.connections['code-1'], openConnection)

  assert.equal(
    removeCodeNodeConnection(openState, 'code-1', openConnection),
    true,
  )
  assert.equal(openState.connections['code-1'], undefined)

  const errorState = createLifecycleState()
  const errorRequestId = beginCodeNodeConnectionRequest(errorState, 'code-1')
  const errorConnection = new FakeConnection()
  trackPendingCodeNodeConnection(
    errorState,
    'code-1',
    errorRequestId,
    errorConnection,
  )

  assert.equal(
    clearPendingCodeNodeConnection(
      errorState,
      'code-1',
      errorRequestId,
      errorConnection,
    ),
    true,
  )
  assert.equal(hasCodeNodeConnectionOrPending(errorState, 'code-1'), false)

  const closeState = createLifecycleState()
  const closeRequestId = beginCodeNodeConnectionRequest(closeState, 'code-1')
  const closeConnection = new FakeConnection()
  trackPendingCodeNodeConnection(
    closeState,
    'code-1',
    closeRequestId,
    closeConnection,
  )

  assert.equal(
    clearPendingCodeNodeConnection(
      closeState,
      'code-1',
      closeRequestId,
      closeConnection,
    ),
    true,
  )
  assert.equal(hasCodeNodeConnectionOrPending(closeState, 'code-1'), false)
})

test('stale connection resolving after disconnect and reconnect is closed', () => {
  const state = createLifecycleState()
  const firstRequestId = beginCodeNodeConnectionRequest(state, 'code-1')

  disconnectCodeNodeConnection(state, 'code-1')

  const secondRequestId = beginCodeNodeConnectionRequest(state, 'code-1')
  const staleConnection = new FakeConnection()

  assert.equal(
    trackPendingCodeNodeConnection(
      state,
      'code-1',
      firstRequestId,
      staleConnection,
    ),
    false,
  )
  assert.equal(staleConnection.closeCount, 1)
  assert.equal(state.pendingConnectionIds.has('code-1'), true)

  const currentConnection = new FakeConnection()
  assert.equal(
    trackPendingCodeNodeConnection(
      state,
      'code-1',
      secondRequestId,
      currentConnection,
    ),
    true,
  )
  assert.equal(
    acceptCodeNodeConnection(
      state,
      'code-1',
      secondRequestId,
      currentConnection,
    ),
    true,
  )

  assert.equal(state.connections['code-1'], currentConnection)
  assert.equal(currentConnection.closeCount, 0)
})

test('disconnect closes active and pending connections and clears state', () => {
  const state = createLifecycleState()
  const activeConnection = new FakeConnection()
  const pendingConnection = new FakeConnection()

  state.connections['code-1'] = activeConnection
  state.pendingConnections['code-1'] = pendingConnection
  state.pendingConnectionIds.add('code-1')
  state.requestIds.set('code-1', Symbol('code-1'))

  disconnectCodeNodeConnection(state, 'code-1')

  assert.equal(activeConnection.closeCount, 1)
  assert.equal(pendingConnection.closeCount, 1)
  assert.equal(state.connections['code-1'], undefined)
  assert.equal(state.pendingConnections['code-1'], undefined)
  assert.equal(state.pendingConnectionIds.has('code-1'), false)
  assert.equal(state.requestIds.has('code-1'), false)
})
