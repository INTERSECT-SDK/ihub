type UpstreamConnection = {
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
}

/**
 * Resolves logical upstream node IDs from a node's React Flow connections.
 *
 * Incoming connections use React Flow's source endpoint. Outgoing connections
 * only represent an upstream node when their handles encode the reverse
 * horizontal direction, in which case the target endpoint is upstream.
 */
export function getLogicalUpstreamNodeIds(
  incomingConnections: readonly UpstreamConnection[],
  outgoingConnections: readonly UpstreamConnection[],
): string[] {
  const upstreamNodeIds = new Set(
    incomingConnections.map((connection) => connection.source),
  )

  for (const connection of outgoingConnections) {
    if (
      connection.sourceHandle === 'input-left' &&
      connection.targetHandle === 'output-right'
    ) {
      upstreamNodeIds.add(connection.target)
    }
  }

  return [...upstreamNodeIds]
}
