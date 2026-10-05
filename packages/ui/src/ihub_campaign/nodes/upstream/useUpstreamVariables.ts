import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from 'react'
import { useNodeConnections, useNodesData } from '@xyflow/react'
import type {
  JupyterServerConfig,
  JupyterSession,
} from '@ihub/utils/types/notebook'
import type { VariableItem } from '@ihub/utils/types/types'
import { getKernelVariables } from '@ihub/utils/helpers/helpers'
import { createConnectionToJupyterSession } from '../../../ihub_notebook'
import { useCodeNodeConnectionRegistry } from '../../state/codeNodeConnectionRegistryContext'
import {
  acceptCodeNodeConnection,
  beginCodeNodeConnectionRequest,
  clearPendingCodeNodeConnection,
  disconnectAllCodeNodeConnections,
  disconnectCodeNodeConnection,
  getCodeNodeConnectionSyncAction,
  isCurrentCodeNodeConnectionRequest,
  removeCodeNodeConnection,
  trackPendingCodeNodeConnection,
  type CodeNodeConnectionLifecycleState,
} from './codeNodeConnectionLifecycle'
import { kernelVariablesToVariableItems } from './kernelVariables'
import { getLogicalUpstreamNodeIds } from './upstreamConnectionDiscovery'
import { buildStaticUpstreamOutputItems } from './staticOutputItems'
import type { CampaignNodeWithData } from './variableOptions'

type UpstreamVariablesResult = {
  parentsOutputItems: Record<string, VariableItem[]>
  parentNodes: CampaignNodeWithData[]
  codeNodeConnectionsRef: MutableRefObject<Record<string, WebSocket>>
}

/**
 * Discovers selectable upstream variables for campaign node configuration.
 *
 * Capability parents are read from their published endpoint payload schema.
 * Code parents are read from their live Jupyter kernel through one websocket
 * per connected parent, with connections closed when parents disconnect or the
 * consuming node unmounts.
 */
export function useUpstreamVariables({
  nodeId,
  includeJsonFileSources = true,
}: {
  nodeId: string
  includeJsonFileSources?: boolean
}): UpstreamVariablesResult {
  const connectionRegistry = useCodeNodeConnectionRegistry()
  const [codeNodeOutputItems, setCodeNodeOutputItems] = useState<
    Record<string, VariableItem[]>
  >({})
  const codeNodeConnectionsRef = useRef<Record<string, WebSocket>>({})
  const pendingCodeNodeConnectionsRef = useRef<Record<string, WebSocket>>({})
  const pendingCodeNodeConnectionIdsRef = useRef<Set<string>>(new Set())
  const codeNodeConnectionRequestIdsRef = useRef<Map<string, symbol>>(new Map())
  const activeCodeNodeIdsRef = useRef<Set<string>>(new Set())
  const isUnmountedRef = useRef(false)
  const connectionConsumerIdRef = useRef(Symbol('upstream-variable-consumer'))

  const incomingConnections = useNodeConnections({
    id: nodeId,
    handleType: 'target',
  })
  const outgoingConnections = useNodeConnections({
    id: nodeId,
    handleType: 'source',
  })

  const sourceNodeIds = useMemo(
    () => getLogicalUpstreamNodeIds(incomingConnections, outgoingConnections),
    [incomingConnections, outgoingConnections],
  )

  const sourceNodeData = useNodesData(sourceNodeIds)

  const staticParentOutputItems = useMemo(
    () =>
      buildStaticUpstreamOutputItems(sourceNodeData, includeJsonFileSources),
    [includeJsonFileSources, sourceNodeData],
  )

  /**
   * Tracks whether the hook is still mounted and guarantees every code-node
   * websocket, including in-flight connection attempts, is closed on unmount.
   */
  useEffect(() => {
    isUnmountedRef.current = false
    const connectionConsumerId = connectionConsumerIdRef.current
    const lifecycleState: CodeNodeConnectionLifecycleState<WebSocket> = {
      connections: codeNodeConnectionsRef.current,
      pendingConnections: pendingCodeNodeConnectionsRef.current,
      pendingConnectionIds: pendingCodeNodeConnectionIdsRef.current,
      requestIds: codeNodeConnectionRequestIdsRef.current,
    }
    const activeCodeNodeIds = activeCodeNodeIdsRef.current

    return () => {
      isUnmountedRef.current = true
      for (const [nodeId, connection] of Object.entries(
        lifecycleState.connections,
      )) {
        connectionRegistry.unregister(nodeId, connectionConsumerId, connection)
      }
      disconnectAllCodeNodeConnections(lifecycleState)
      activeCodeNodeIds.clear()
    }
  }, [connectionRegistry])

  /**
   * Synchronizes live code-node parents with Jupyter websocket connections:
   * closes stale parents, opens missing sessions, and refreshes variables only
   * for the currently connected upstream code nodes.
   */
  useEffect(() => {
    const activeCodeNodeIds = new Set<string>()
    const lifecycleState: CodeNodeConnectionLifecycleState<WebSocket> = {
      connections: codeNodeConnectionsRef.current,
      pendingConnections: pendingCodeNodeConnectionsRef.current,
      pendingConnectionIds: pendingCodeNodeConnectionIdsRef.current,
      requestIds: codeNodeConnectionRequestIdsRef.current,
    }

    const fetchKernelVariables = (
      nodeId: string,
      ws: WebSocket,
      kernelId: string,
    ) => {
      setCodeNodeOutputItems((prev) => ({
        ...prev,
        [nodeId]: [],
      }))

      getKernelVariables(ws, kernelId)
        .then((variables) => {
          if (
            isUnmountedRef.current ||
            !activeCodeNodeIdsRef.current.has(nodeId)
          ) {
            return
          }

          setCodeNodeOutputItems((prev) => ({
            ...prev,
            [nodeId]: kernelVariablesToVariableItems(variables),
          }))
        })
        .catch(() => {
          if (
            isUnmountedRef.current ||
            !activeCodeNodeIdsRef.current.has(nodeId)
          ) {
            return
          }

          setCodeNodeOutputItems((prev) => ({
            ...prev,
            [nodeId]: [],
          }))
        })
    }

    for (const node of sourceNodeData) {
      if (node.type === 'code') {
        activeCodeNodeIds.add(node.id)
      }
    }
    activeCodeNodeIdsRef.current = activeCodeNodeIds

    for (const nodeId of Object.keys(lifecycleState.connections)) {
      if (!activeCodeNodeIds.has(nodeId)) {
        const connection = lifecycleState.connections[nodeId]
        if (connection) {
          connectionRegistry.unregister(
            nodeId,
            connectionConsumerIdRef.current,
            connection,
          )
        }
        disconnectCodeNodeConnection(lifecycleState, nodeId)
      }
    }

    for (const nodeId of lifecycleState.pendingConnectionIds) {
      if (!activeCodeNodeIds.has(nodeId)) {
        disconnectCodeNodeConnection(lifecycleState, nodeId)
      }
    }

    setCodeNodeOutputItems((prev) => {
      const nextEntries = Object.entries(prev).filter(([nodeId]) =>
        activeCodeNodeIds.has(nodeId),
      )
      if (nextEntries.length === Object.keys(prev).length) {
        return prev
      }
      return Object.fromEntries(nextEntries)
    })

    for (const node of sourceNodeData) {
      if (node.type !== 'code') {
        continue
      }

      const syncAction = getCodeNodeConnectionSyncAction(
        lifecycleState,
        node.id,
        (connection) => connection.readyState === WebSocket.OPEN,
      )

      if (syncAction === 'refresh-active') {
        const existingConnection = lifecycleState.connections[node.id]
        const kernel = node.data.kernel as JupyterSession

        if (!existingConnection) {
          continue
        }

        fetchKernelVariables(node.id, existingConnection, kernel.id)
        continue
      }

      if (syncAction !== 'connect') {
        continue
      }

      const kernel = node.data.kernel as JupyterSession
      const server = node.data.server as JupyterServerConfig

      const requestId = beginCodeNodeConnectionRequest(lifecycleState, node.id)
      createConnectionToJupyterSession(kernel, server)
        .then((connection: WebSocket) => {
          if (
            !connection ||
            isUnmountedRef.current ||
            !activeCodeNodeIdsRef.current.has(node.id) ||
            !isCurrentCodeNodeConnectionRequest(
              lifecycleState,
              node.id,
              requestId,
            )
          ) {
            connection?.close()
            return
          }

          if (
            !trackPendingCodeNodeConnection(
              lifecycleState,
              node.id,
              requestId,
              connection,
            )
          ) {
            return
          }

          let accepted = false

          const connectAndFetch = () => {
            if (accepted) {
              return
            }

            if (
              isUnmountedRef.current ||
              !activeCodeNodeIdsRef.current.has(node.id) ||
              !isCurrentCodeNodeConnectionRequest(
                lifecycleState,
                node.id,
                requestId,
              )
            ) {
              clearPendingCodeNodeConnection(
                lifecycleState,
                node.id,
                requestId,
                connection,
              )
              connection.close()
              return
            }

            if (lifecycleState.connections[node.id]) {
              clearPendingCodeNodeConnection(
                lifecycleState,
                node.id,
                requestId,
                connection,
              )
              connection.close()
              return
            }

            accepted = acceptCodeNodeConnection(
              lifecycleState,
              node.id,
              requestId,
              connection,
            )
            if (!accepted) {
              return
            }

            connectionRegistry.register(
              node.id,
              connectionConsumerIdRef.current,
              connection,
            )
            fetchKernelVariables(node.id, connection, kernel.id)
          }

          connection.onopen = connectAndFetch

          connection.onerror = () => {
            clearPendingCodeNodeConnection(
              lifecycleState,
              node.id,
              requestId,
              connection,
            )
          }

          connection.onclose = () => {
            connectionRegistry.unregister(
              node.id,
              connectionConsumerIdRef.current,
              connection,
            )
            clearPendingCodeNodeConnection(
              lifecycleState,
              node.id,
              requestId,
              connection,
            )

            if (
              removeCodeNodeConnection(lifecycleState, node.id, connection) &&
              !isUnmountedRef.current
            ) {
              setCodeNodeOutputItems((prev) => {
                const next = { ...prev }
                delete next[node.id]
                return next
              })
            }
          }

          if (connection.readyState === WebSocket.OPEN) {
            connectAndFetch()
          } else if (
            connection.readyState === WebSocket.CLOSING ||
            connection.readyState === WebSocket.CLOSED
          ) {
            clearPendingCodeNodeConnection(
              lifecycleState,
              node.id,
              requestId,
              connection,
            )
          }
        })
        .catch(() => {
          clearPendingCodeNodeConnection(lifecycleState, node.id, requestId)
        })
    }
  }, [connectionRegistry, sourceNodeData])

  const parentsOutputItems = useMemo(
    () => ({
      ...staticParentOutputItems,
      ...codeNodeOutputItems,
    }),
    [staticParentOutputItems, codeNodeOutputItems],
  )

  return {
    parentsOutputItems,
    parentNodes: sourceNodeData as CampaignNodeWithData[],
    codeNodeConnectionsRef,
  }
}
