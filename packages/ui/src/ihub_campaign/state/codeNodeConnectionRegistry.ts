/**
 * Minimal socket shape needed by the campaign-scoped connection registry.
 */
export type CodeNodeConnection = {
  readyState: number
}

export type CodeNodeConnectionConsumerId = symbol

/**
 * Registry of the live code-node sockets already owned by campaign consumers.
 */
export type CodeNodeConnectionRegistry<
  Connection extends CodeNodeConnection = WebSocket,
> = {
  register: (
    nodeId: string,
    consumerId: CodeNodeConnectionConsumerId,
    connection: Connection,
  ) => void
  unregister: (
    nodeId: string,
    consumerId: CodeNodeConnectionConsumerId,
    connection: Connection,
  ) => boolean
  getOpenConnection: (nodeId: string) => Connection | undefined
}

/**
 * Creates an isolated registry for one mounted campaign editor.
 *
 * Multiple graph nodes may independently own sockets to the same code node.
 * Consumer identity and connection identity are both checked during cleanup so
 * a stale close event cannot unregister a newer socket.
 */
export function createCodeNodeConnectionRegistry<
  Connection extends CodeNodeConnection = WebSocket,
>(): CodeNodeConnectionRegistry<Connection> {
  const connectionsByNode = new Map<
    string,
    Map<CodeNodeConnectionConsumerId, Connection>
  >()

  return {
    register(nodeId, consumerId, connection) {
      const consumers = connectionsByNode.get(nodeId) ?? new Map()
      consumers.set(consumerId, connection)
      connectionsByNode.set(nodeId, consumers)
    },

    unregister(nodeId, consumerId, connection) {
      const consumers = connectionsByNode.get(nodeId)
      if (consumers?.get(consumerId) !== connection) {
        return false
      }

      consumers.delete(consumerId)
      if (consumers.size === 0) {
        connectionsByNode.delete(nodeId)
      }
      return true
    },

    getOpenConnection(nodeId) {
      const consumers = connectionsByNode.get(nodeId)
      if (!consumers) {
        return undefined
      }

      return [...consumers.values()].find(
        (connection) => connection.readyState === 1,
      )
    },
  }
}
