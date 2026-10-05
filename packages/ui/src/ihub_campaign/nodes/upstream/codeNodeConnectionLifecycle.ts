/**
 * Utilities for coordinating active and pending code node connections while
 * protecting against stale async connection requests.
 */
type ClosableConnection = {
  close: () => void
}

export type CodeNodeConnectionLifecycleState<
  Connection extends ClosableConnection,
> = {
  connections: Record<string, Connection>
  pendingConnections: Record<string, Connection>
  pendingConnectionIds: Set<string>
  requestIds: Map<string, symbol>
}

export type CodeNodeConnectionSyncAction =
  | 'refresh-active'
  | 'skip-active'
  | 'await-pending'
  | 'connect'

/**
 * Chooses how a code node should synchronize its upstream variables for the
 * current render.
 *
 * @param state - Mutable lifecycle state that tracks code node connections.
 * @param nodeId - Identifier of the code node to inspect.
 * @param canRefreshConnection - Predicate that returns whether the active
 * connection is currently usable for a variable refresh.
 * @returns The next action for the calling hook.
 */
export function getCodeNodeConnectionSyncAction<
  Connection extends ClosableConnection,
>(
  state: CodeNodeConnectionLifecycleState<Connection>,
  nodeId: string,
  canRefreshConnection: (connection: Connection) => boolean,
): CodeNodeConnectionSyncAction {
  const activeConnection = state.connections[nodeId]
  if (activeConnection) {
    return canRefreshConnection(activeConnection)
      ? 'refresh-active'
      : 'skip-active'
  }

  if (state.pendingConnectionIds.has(nodeId)) {
    return 'await-pending'
  }

  return 'connect'
}

/**
 * Checks whether a node already has an active connection or a pending
 * connection request.
 *
 * @param state - Mutable lifecycle state that tracks code node connections.
 * @param nodeId - Identifier of the code node to inspect.
 * @returns `true` when the node has an active connection or pending request.
 */
export function hasCodeNodeConnectionOrPending<
  Connection extends ClosableConnection,
>(
  state: CodeNodeConnectionLifecycleState<Connection>,
  nodeId: string,
): boolean {
  return (
    Boolean(state.connections[nodeId]) || state.pendingConnectionIds.has(nodeId)
  )
}

/**
 * Starts a new connection request for a node and records its request token.
 *
 * @param state - Mutable lifecycle state that tracks code node connections.
 * @param nodeId - Identifier of the code node requesting a connection.
 * @returns A unique request token used to validate later lifecycle updates.
 */
export function beginCodeNodeConnectionRequest<
  Connection extends ClosableConnection,
>(state: CodeNodeConnectionLifecycleState<Connection>, nodeId: string): symbol {
  const requestId = Symbol(nodeId)
  state.pendingConnectionIds.add(nodeId)
  state.requestIds.set(nodeId, requestId)
  return requestId
}

/**
 * Determines whether a request token is still the latest request for a node.
 *
 * @param state - Mutable lifecycle state that tracks code node connections.
 * @param nodeId - Identifier of the code node associated with the request.
 * @param requestId - Request token to compare against the latest recorded one.
 * @returns `true` when the token matches the current request for the node.
 */
export function isCurrentCodeNodeConnectionRequest<
  Connection extends ClosableConnection,
>(
  state: CodeNodeConnectionLifecycleState<Connection>,
  nodeId: string,
  requestId: symbol,
): boolean {
  return state.requestIds.get(nodeId) === requestId
}

/**
 * Stores a pending connection if its request is current, otherwise closes it.
 *
 * @param state - Mutable lifecycle state that tracks code node connections.
 * @param nodeId - Identifier of the code node associated with the connection.
 * @param requestId - Request token that produced the pending connection.
 * @param connection - Connection to track while it waits to become active.
 * @returns `true` when the connection was accepted as pending.
 */
export function trackPendingCodeNodeConnection<
  Connection extends ClosableConnection,
>(
  state: CodeNodeConnectionLifecycleState<Connection>,
  nodeId: string,
  requestId: symbol,
  connection: Connection,
): boolean {
  if (!isCurrentCodeNodeConnectionRequest(state, nodeId, requestId)) {
    connection.close()
    return false
  }

  state.pendingConnections[nodeId] = connection
  return true
}

/**
 * Promotes a connection to active when its request token is still current.
 *
 * @param state - Mutable lifecycle state that tracks code node connections.
 * @param nodeId - Identifier of the code node associated with the connection.
 * @param requestId - Request token that produced the active connection.
 * @param connection - Connection to activate for the node.
 * @returns `true` when the connection became active.
 */
export function acceptCodeNodeConnection<Connection extends ClosableConnection>(
  state: CodeNodeConnectionLifecycleState<Connection>,
  nodeId: string,
  requestId: symbol,
  connection: Connection,
): boolean {
  if (!isCurrentCodeNodeConnectionRequest(state, nodeId, requestId)) {
    connection.close()
    return false
  }

  clearPendingCodeNodeConnection(state, nodeId, requestId, connection)
  state.connections[nodeId] = connection
  return true
}

/**
 * Clears pending request bookkeeping when the provided request is current.
 *
 * @param state - Mutable lifecycle state that tracks code node connections.
 * @param nodeId - Identifier of the code node whose pending state is cleared.
 * @param requestId - Request token that is allowed to clear pending state.
 * @param connection - Optional pending connection that should be cleared only
 * when it is still the tracked pending connection.
 * @returns `true` when pending state was cleared for the current request.
 */
export function clearPendingCodeNodeConnection<
  Connection extends ClosableConnection,
>(
  state: CodeNodeConnectionLifecycleState<Connection>,
  nodeId: string,
  requestId: symbol,
  connection?: Connection,
): boolean {
  if (!isCurrentCodeNodeConnectionRequest(state, nodeId, requestId)) {
    return false
  }

  state.pendingConnectionIds.delete(nodeId)
  state.requestIds.delete(nodeId)

  if (!connection || state.pendingConnections[nodeId] === connection) {
    delete state.pendingConnections[nodeId]
  }

  return true
}

/**
 * Removes an active connection only if it is still the tracked connection.
 *
 * @param state - Mutable lifecycle state that tracks code node connections.
 * @param nodeId - Identifier of the code node whose connection is removed.
 * @param connection - Active connection instance expected for the node.
 * @returns `true` when the active connection matched and was removed.
 */
export function removeCodeNodeConnection<Connection extends ClosableConnection>(
  state: CodeNodeConnectionLifecycleState<Connection>,
  nodeId: string,
  connection: Connection,
): boolean {
  if (state.connections[nodeId] !== connection) {
    return false
  }

  delete state.connections[nodeId]
  return true
}

/**
 * Closes and removes all active and pending connection state for one node.
 *
 * @param state - Mutable lifecycle state that tracks code node connections.
 * @param nodeId - Identifier of the code node to disconnect.
 */
export function disconnectCodeNodeConnection<
  Connection extends ClosableConnection,
>(state: CodeNodeConnectionLifecycleState<Connection>, nodeId: string): void {
  const activeConnection = state.connections[nodeId]
  if (activeConnection) {
    activeConnection.close()
    delete state.connections[nodeId]
  }

  const pendingConnection = state.pendingConnections[nodeId]
  if (pendingConnection && pendingConnection !== activeConnection) {
    pendingConnection.close()
  }

  delete state.pendingConnections[nodeId]
  state.pendingConnectionIds.delete(nodeId)
  state.requestIds.delete(nodeId)
}

/**
 * Closes and removes every active and pending code node connection.
 *
 * @param state - Mutable lifecycle state that tracks code node connections.
 */
export function disconnectAllCodeNodeConnections<
  Connection extends ClosableConnection,
>(state: CodeNodeConnectionLifecycleState<Connection>): void {
  const nodeIds = new Set([
    ...Object.keys(state.connections),
    ...Object.keys(state.pendingConnections),
    ...state.pendingConnectionIds,
    ...state.requestIds.keys(),
  ])

  for (const nodeId of nodeIds) {
    disconnectCodeNodeConnection(state, nodeId)
  }
}
