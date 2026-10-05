import {
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type OnConnectStart,
  useEdgesState,
  useNodesState,
} from '@xyflow/react'
import type {
  CampaignEdge,
  CampaignModel,
  CampaignNode,
} from '@ihub/utils/types/campaign'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from 'react'

import {
  buildCampaignEdge,
  isExecutableCampaignTaskConnection,
  isValidCampaignConnection,
  orientCampaignConnectionFromDragStart,
} from '../graph/connections'
import {
  deleteCampaignModelTask,
  deleteCampaignModelTaskGroup,
} from '../graph/campaignModelDeletion'
import {
  buildCampaignModelContextGraph,
  projectCampaignModelGraph,
  serializeCampaignModelGraph,
} from '../graph/campaignModelProjection'
import {
  useCampaignActions,
  useCampaignStore,
  useCampaignStoreSelector,
} from '../state/campaignContext'
import { layoutGraph, type LayoutMode } from './layout'
import { masterCampaignSheetId } from './campaignEditorState'
import {
  preserveCampaignModelCapabilityInputs,
  preserveCampaignGraphSelection,
  reconcileCampaignGraph,
  type CampaignGraphScope,
} from './campaignGraphSynchronization'

/** Synchronizes CampaignModel graph state with React Flow and campaign context. */
export function useCampaignGraphEditor({
  campaignModel,
  campaignIdentity,
  viewIdentity,
  selectedSheetId,
  persistCampaignModel,
  latestCampaignModelRef,
  latestPersistCampaignModelRef,
  latestSelectedTaskGroupIdRef,
  setSelectedSheetId,
  flushCapabilityInputDrafts,
}: {
  campaignModel: CampaignModel
  campaignIdentity: string
  viewIdentity: string
  selectedSheetId: string
  persistCampaignModel: (campaignModel: CampaignModel) => void
  latestCampaignModelRef: MutableRefObject<CampaignModel>
  latestPersistCampaignModelRef: MutableRefObject<
    (campaignModel: CampaignModel) => void
  >
  latestSelectedTaskGroupIdRef: MutableRefObject<string | null>
  setSelectedSheetId: (sheetId: string) => void
  flushCapabilityInputDrafts: () => CampaignModel
}) {
  const campaignStore = useCampaignStore()
  const editorRevision = useCampaignStoreSelector(
    (snapshot) => snapshot.editorRevision,
  )
  const { setCampaign: setContextCampaign } = useCampaignActions()
  const derivedNodes = useMemo(
    () => projectCampaignModelGraph(campaignModel, selectedSheetId).nodes,
    [campaignModel, selectedSheetId],
  )
  const [flowNodes, setFlowNodes] = useNodesState<Node>([])
  const [flowEdges, setFlowEdges] = useEdgesState<CampaignEdge>([])
  const [graphReadyCampaignId, setGraphReadyCampaignId] = useState<
    string | null
  >(null)
  const connectStartRef = useRef<{
    nodeId?: string | null
    handleId?: string | null
    handleType?: string | null
  } | null>(null)
  const edgeReconnectSuccessful = useRef(true)
  const handledEditorRevisionRef = useRef(0)
  const graphScopeRef = useRef<CampaignGraphScope | null>(null)
  const flowNodesRef = useRef<Node[]>([])
  const flowEdgesRef = useRef<CampaignEdge[]>([])
  const isGraphReady = graphReadyCampaignId === campaignIdentity

  useEffect(() => {
    const expectedNodeIds = new Set(derivedNodes.map(({ id }) => id))
    if (
      flowNodes.length === expectedNodeIds.size &&
      flowNodes.every(({ id }) => expectedNodeIds.has(id))
    ) {
      setGraphReadyCampaignId(campaignIdentity)
    }
  }, [campaignIdentity, derivedNodes, flowNodes])

  useEffect(() => {
    flowNodesRef.current = flowNodes
  }, [flowNodes])
  useEffect(() => {
    flowEdgesRef.current = flowEdges
  }, [flowEdges])
  const persistGraphState = useCallback(
    (
      nextNodes: Node[],
      nextEdges: CampaignEdge[],
      campaignModelBase: CampaignModel = latestCampaignModelRef.current,
    ) => {
      const reconciledNodes = preserveCampaignModelCapabilityInputs(
        campaignModelBase,
        selectedSheetId,
        nextNodes,
      )
      const nextCampaignModel = serializeCampaignModelGraph(
        campaignModelBase,
        selectedSheetId,
        reconciledNodes,
        nextEdges,
      )
      persistCampaignModel(nextCampaignModel)
      setContextCampaign(
        buildCampaignModelContextGraph(
          nextCampaignModel,
          reconciledNodes,
          nextEdges,
        ),
      )
    },
    [
      latestCampaignModelRef,
      persistCampaignModel,
      selectedSheetId,
      setContextCampaign,
    ],
  )

  useEffect(() => {
    const nextGraphScope = { viewIdentity, selectedSheetId }
    const reconciliation = reconcileCampaignGraph({
      campaignModel: latestCampaignModelRef.current,
      selectedSheetId,
      storeSnapshot: campaignStore.getSnapshot(),
      handledEditorRevision: handledEditorRevisionRef.current,
    })
    const presentationNodes = preserveCampaignGraphSelection(
      flowNodesRef.current,
      reconciliation.nodes,
      graphScopeRef.current,
      nextGraphScope,
    )
    graphScopeRef.current = nextGraphScope

    setFlowNodes(presentationNodes)
    setFlowEdges(reconciliation.edges)
    setContextCampaign(
      buildCampaignModelContextGraph(
        reconciliation.campaignModel,
        reconciliation.nodes,
        reconciliation.edges,
      ),
    )
    if (reconciliation.source === 'editor') {
      persistCampaignModel(reconciliation.campaignModel)
      handledEditorRevisionRef.current = reconciliation.handledEditorRevision
    }
  }, [
    campaignStore,
    campaignModel,
    editorRevision,
    latestCampaignModelRef,
    persistCampaignModel,
    selectedSheetId,
    setContextCampaign,
    setFlowEdges,
    setFlowNodes,
    viewIdentity,
  ])

  const handleModelLayout = useCallback(
    async (mode: LayoutMode = 'force') => {
      const { nodes, edges } = await layoutGraph(
        flowNodes as unknown as CampaignNode[],
        flowEdges,
        'RIGHT',
        mode,
      )
      const nextNodes = nodes as unknown as Node[]
      const nextEdges = edges as CampaignEdge[]
      setFlowNodes(nextNodes)
      setFlowEdges(nextEdges)
      persistGraphState(nextNodes, nextEdges)
    },
    [flowEdges, flowNodes, persistGraphState, setFlowEdges, setFlowNodes],
  )
  const onNodeDragStop = useCallback(
    (_event: unknown, node: Node) => {
      const nextNodes = flowNodesRef.current.map((currentNode) =>
        currentNode.id === node.id
          ? { ...currentNode, position: { ...node.position } }
          : currentNode,
      )
      setFlowNodes(nextNodes)
      persistGraphState(nextNodes, flowEdgesRef.current)
    },
    [persistGraphState, setFlowNodes],
  )
  const onModelNodesChange = useCallback(
    (changes: NodeChange<Node>[]) => {
      const nextNodes = applyNodeChanges(changes, flowNodesRef.current)
      const removedNodeIds = new Set(
        changes
          .filter((change) => change.type === 'remove')
          .map((change) => change.id),
      )
      if (removedNodeIds.size > 0) {
        const flushedCampaignModel = flushCapabilityInputDrafts()
        const nextEdges = flowEdgesRef.current.filter(
          (edge) =>
            !removedNodeIds.has(edge.source) &&
            !removedNodeIds.has(edge.target),
        )
        setFlowNodes(nextNodes)
        setFlowEdges(nextEdges)
        persistGraphState(nextNodes, nextEdges, flushedCampaignModel)
        return
      }
      setFlowNodes(nextNodes)
    },
    [flushCapabilityInputDrafts, persistGraphState, setFlowEdges, setFlowNodes],
  )
  const onModelEdgesChange = useCallback(
    (changes: EdgeChange<CampaignEdge>[]) => {
      const nextEdges = applyEdgeChanges(changes, flowEdgesRef.current)
      setFlowEdges(nextEdges)
      if (changes.some((change) => change.type === 'remove')) {
        persistGraphState(flowNodesRef.current, nextEdges)
      }
    },
    [persistGraphState, setFlowEdges],
  )
  const isValidConnection = useCallback(
    (connection: Connection | CampaignEdge) =>
      isValidCampaignConnection(connection, flowNodesRef.current),
    [],
  )
  const onConnectStart = useCallback<OnConnectStart>((_, params) => {
    connectStartRef.current = {
      nodeId: params?.nodeId,
      handleId: params?.handleId,
      handleType: params?.handleType,
    }
  }, [])
  const onConnectEnd = useCallback(() => {
    connectStartRef.current = null
  }, [])
  const onConnect = useCallback(
    (connection: Connection) => {
      const nodes = flowNodesRef.current
      const edges = flowEdgesRef.current
      const dragStartNodeId = connectStartRef.current?.nodeId ?? undefined
      const orientedConnection =
        selectedSheetId === masterCampaignSheetId
          ? orientCampaignConnectionFromDragStart(connection, dragStartNodeId)
          : connection
      const selectedTaskGroup = latestCampaignModelRef.current.task_groups.find(
        ({ id }) => id === latestSelectedTaskGroupIdRef.current,
      )
      const newEdge = buildCampaignEdge(orientedConnection, nodes, {
        dragStartNodeId,
        isDependencyEdge:
          selectedSheetId === masterCampaignSheetId
            ? true
            : isExecutableCampaignTaskConnection(
                orientedConnection,
                selectedTaskGroup?.tasks ?? [],
              ),
      })
      if (!newEdge) return
      const nextEdges = [...edges, newEdge]
      setFlowEdges(nextEdges)
      persistGraphState(nodes, nextEdges)
      connectStartRef.current = null
    },
    [
      latestCampaignModelRef,
      latestSelectedTaskGroupIdRef,
      persistGraphState,
      selectedSheetId,
      setFlowEdges,
    ],
  )
  const onReconnectStart = useCallback(() => {
    edgeReconnectSuccessful.current = false
  }, [])
  const onReconnect = useCallback(
    (oldEdge: Edge, newConnection: Connection) => {
      const nodes = flowNodesRef.current
      if (!isValidConnection(newConnection)) {
        edgeReconnectSuccessful.current = false
        return
      }
      const selectedTaskGroup = latestCampaignModelRef.current.task_groups.find(
        ({ id }) => id === latestSelectedTaskGroupIdRef.current,
      )
      const updatedEdge = buildCampaignEdge(newConnection, nodes, {
        oldEdge: oldEdge as CampaignEdge,
        isDependencyEdge:
          selectedSheetId === masterCampaignSheetId
            ? true
            : isExecutableCampaignTaskConnection(
                newConnection,
                selectedTaskGroup?.tasks ?? [],
              ),
      })
      if (!updatedEdge) {
        edgeReconnectSuccessful.current = false
        return
      }
      edgeReconnectSuccessful.current = true
      const nextEdges = flowEdgesRef.current.map((edge) =>
        edge.id === oldEdge.id ? updatedEdge : edge,
      )
      setFlowEdges(nextEdges)
      persistGraphState(nodes, nextEdges)
    },
    [
      isValidConnection,
      latestCampaignModelRef,
      latestSelectedTaskGroupIdRef,
      persistGraphState,
      selectedSheetId,
      setFlowEdges,
    ],
  )
  const onReconnectEnd = useCallback(
    (_event: MouseEvent | TouchEvent, edge: Edge) => {
      if (!edgeReconnectSuccessful.current) {
        const nextEdges = flowEdgesRef.current.filter(
          (current) => current.id !== edge.id,
        )
        setFlowEdges(nextEdges)
        persistGraphState(flowNodesRef.current, nextEdges)
      }
      edgeReconnectSuccessful.current = true
    },
    [persistGraphState, setFlowEdges],
  )
  const handleDeleteTaskGroup = useCallback(
    (taskGroupId: string) => {
      const flushedCampaignModel = flushCapabilityInputDrafts()
      latestPersistCampaignModelRef.current(
        deleteCampaignModelTaskGroup(flushedCampaignModel, taskGroupId),
      )
    },
    [flushCapabilityInputDrafts, latestPersistCampaignModelRef],
  )
  const handleDeleteTask = useCallback(
    (taskId: string) => {
      const flushedCampaignModel = flushCapabilityInputDrafts()
      const taskGroupId = latestSelectedTaskGroupIdRef.current
      if (!taskGroupId) return
      latestPersistCampaignModelRef.current(
        deleteCampaignModelTask(flushedCampaignModel, taskGroupId, taskId),
      )
    },
    [
      latestPersistCampaignModelRef,
      latestSelectedTaskGroupIdRef,
      flushCapabilityInputDrafts,
    ],
  )

  return {
    flowNodes,
    flowEdges,
    isGraphReady,
    handleModelLayout,
    onNodeDragStop,
    onModelNodesChange,
    onModelEdgesChange,
    isValidConnection,
    onConnectStart,
    onConnectEnd,
    onConnect,
    onReconnectStart,
    onReconnect,
    onReconnectEnd,
    handleDeleteTaskGroup,
    handleDeleteTask,
    setSelectedSheetId,
  }
}
