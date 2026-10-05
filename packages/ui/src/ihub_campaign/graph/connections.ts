/** Campaign graph connection validation and edge construction helpers. */
import { MarkerType, type Node } from '@xyflow/react'
import type {
  CampaignEdge,
  CampaignTask,
  DataMappingList,
} from '@ihub/utils/types/campaign'

// Node's focused TypeScript test runner requires the imported file extension.
// @ts-expect-error TypeScript extensions are valid here because this package is no-emit.
import { isExecutableCampaignTask } from '../model/selectors.ts'

type CampaignConnection = {
  source?: string | null
  target?: string | null
  sourceHandle?: string | null
  targetHandle?: string | null
}

type CampaignConnectionOptions = {
  dragStartNodeId?: string
}

type BuildCampaignEdgeOptions = CampaignConnectionOptions & {
  oldEdge?: CampaignEdge
  isDependencyEdge?: boolean
}

type CampaignTaskEdgeConnection = {
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
}

type CampaignTaskEdgeEndpoints = Pick<
  CampaignTaskEdgeConnection,
  'source' | 'target'
>

const JSON_CONNECTION_WARNING =
  'JSON File and JSON Text nodes can only connect from their output to a Capability input.'

/**
 * Returns dependency/data-flow endpoints for an edge on a task sheet.
 *
 * Reverse-horizontal React Flow edges store their visual endpoints opposite to
 * their logical direction. This rule does not apply to master-sheet task-group
 * edges, whose direction is determined by the drag origin.
 */
export function getLogicalCampaignTaskEdgeEndpoints(
  connection: CampaignTaskEdgeConnection,
): CampaignTaskEdgeEndpoints {
  if (
    connection.sourceHandle === 'input-left' &&
    connection.targetHandle === 'output-right'
  ) {
    return { source: connection.target, target: connection.source }
  }

  return { source: connection.source, target: connection.target }
}

function isJsonSourceNode(node: Node): boolean {
  return node.type === 'json-file' || node.type === 'json-text'
}

function isRendererNode(node: Node): boolean {
  return node.type === 'image-renderer' || node.type === 'text-renderer'
}

/**
 * Orients a loose-mode connection so the node where the drag began is the
 * logical source. React Flow otherwise derives source and target from handle
 * types, which can reverse the user's drag direction.
 */
export function orientCampaignConnectionFromDragStart(
  connection: CampaignConnection,
  dragStartNodeId?: string,
): CampaignConnection {
  if (!dragStartNodeId || dragStartNodeId === connection.source) {
    return connection
  }

  if (dragStartNodeId !== connection.target) {
    return connection
  }

  return {
    source: connection.target,
    target: connection.source,
    sourceHandle: connection.targetHandle,
    targetHandle: connection.sourceHandle,
  }
}

function hasValidCampaignConnectionHandles(connection: CampaignConnection) {
  const { sourceHandle, targetHandle } = connection
  return (
    (sourceHandle === 'bottom' && targetHandle === 'top') ||
    (sourceHandle === 'top' && targetHandle === 'bottom') ||
    (sourceHandle === 'bottom' && targetHandle === 'bottom') ||
    (sourceHandle === 'top' && targetHandle === 'top') ||
    (sourceHandle === 'output-right' && targetHandle === 'input-left') ||
    (sourceHandle === 'input-left' && targetHandle === 'output-right')
  )
}

function getConnectionNodes(connection: CampaignConnection, nodes: Node[]) {
  const sourceNode = nodes.find((node) => node.id === connection.source)
  const targetNode = nodes.find((node) => node.id === connection.target)
  return { sourceNode, targetNode }
}

function isExecutableCampaignNode(node: Node): boolean {
  return node.type === 'capability' || node.type === 'event'
}

/** Returns whether both endpoints represent orchestrator-executable tasks. */
export function isExecutableCampaignConnection(
  connection: CampaignConnection,
  nodes: Node[],
): boolean {
  const { sourceNode, targetNode } = getConnectionNodes(connection, nodes)
  if (connection.source === connection.target) return false
  return Boolean(
    sourceNode &&
    targetNode &&
    isExecutableCampaignNode(sourceNode) &&
    isExecutableCampaignNode(targetNode),
  )
}

/** Returns whether both canonical task endpoints participate in execution. */
export function isExecutableCampaignTaskConnection(
  connection: CampaignConnection,
  tasks: CampaignTask[],
): boolean {
  if (
    !connection.source ||
    !connection.target ||
    connection.source === connection.target
  ) {
    return false
  }

  const sourceTask = tasks.find((task) => task.id === connection.source)
  const targetTask = tasks.find((task) => task.id === connection.target)
  return Boolean(
    sourceTask &&
    targetTask &&
    isExecutableCampaignTask(sourceTask) &&
    isExecutableCampaignTask(targetTask),
  )
}

function isHorizontalConnection(connection: CampaignConnection) {
  return (
    (connection.sourceHandle === 'output-right' &&
      connection.targetHandle === 'input-left') ||
    (connection.sourceHandle === 'input-left' &&
      connection.targetHandle === 'output-right')
  )
}

function getUnsupportedJsonConnectionWarning(
  connection: CampaignConnection,
  nodes: Node[],
  options: CampaignConnectionOptions = {},
) {
  if (!isHorizontalConnection(connection)) {
    return null
  }

  const { sourceNode, targetNode } = getConnectionNodes(connection, nodes)
  if (!sourceNode || !targetNode) {
    return null
  }

  const dragTargetNode =
    options.dragStartNodeId === sourceNode.id
      ? targetNode
      : options.dragStartNodeId === targetNode.id
        ? sourceNode
        : undefined
  if (dragTargetNode && isJsonSourceNode(dragTargetNode)) {
    return JSON_CONNECTION_WARNING
  }

  if (isJsonSourceNode(targetNode)) {
    return JSON_CONNECTION_WARNING
  }

  if (!isJsonSourceNode(sourceNode)) {
    return null
  }

  const isCanonicalJsonToCapability =
    (targetNode.type === 'capability' || isRendererNode(targetNode)) &&
    connection.sourceHandle === 'output-right' &&
    connection.targetHandle === 'input-left'

  return isCanonicalJsonToCapability ? null : JSON_CONNECTION_WARNING
}

/** Returns a user-facing warning for a specifically unsupported connection. */
export function getCampaignConnectionWarning(
  connection: CampaignConnection,
  nodes: Node[],
  options: CampaignConnectionOptions = {},
): string | null {
  return getUnsupportedJsonConnectionWarning(connection, nodes, options)
}

function getHorizontalDirection(
  connection: CampaignConnection,
  nodes: Node[],
  dragStartNodeId?: string,
) {
  if (!isHorizontalConnection(connection)) {
    return undefined
  }

  const { sourceNode, targetNode } = getConnectionNodes(connection, nodes)
  if (!sourceNode || !targetNode) {
    return undefined
  }

  if (dragStartNodeId === sourceNode.id) {
    return targetNode.position.x >= sourceNode.position.x ? 'right' : 'left'
  }
  if (dragStartNodeId === targetNode.id) {
    return sourceNode.position.x >= targetNode.position.x ? 'right' : 'left'
  }
  return targetNode.position.x >= sourceNode.position.x ? 'right' : 'left'
}

/** Returns whether a connection references existing nodes and valid handles. */
export function isValidCampaignConnection(
  connection: CampaignConnection,
  nodes: Node[],
  options: CampaignConnectionOptions = {},
) {
  if (!connection.source || !connection.target) {
    return false
  }
  const { sourceNode, targetNode } = getConnectionNodes(connection, nodes)
  return Boolean(
    sourceNode &&
    targetNode &&
    hasValidCampaignConnectionHandles(connection) &&
    !getCampaignConnectionWarning(connection, nodes, options),
  )
}

/** Builds a campaign edge and preserves reconnect data mappings. */
export function buildCampaignEdge(
  connection: CampaignConnection,
  nodes: Node[],
  options: BuildCampaignEdgeOptions = {},
): CampaignEdge | null {
  if (!isValidCampaignConnection(connection, nodes, options)) {
    return null
  }

  const isHorizontal = isHorizontalConnection(connection)
  const isFeedback =
    connection.sourceHandle === 'bottom' && connection.targetHandle === 'top'
  const isOrthogonal =
    (connection.sourceHandle === 'bottom' &&
      connection.targetHandle === 'bottom') ||
    (connection.sourceHandle === 'top' && connection.targetHandle === 'top')
  const horizontalDirection = getHorizontalDirection(
    connection,
    nodes,
    options.dragStartNodeId,
  )

  return {
    ...(options.oldEdge ?? {}),
    id:
      options.oldEdge?.id ??
      `edge-${connection.source}-${connection.sourceHandle}-${connection.target}-${connection.targetHandle}`,
    source: connection.source!,
    target: connection.target!,
    sourceHandle: connection.sourceHandle,
    targetHandle: connection.targetHandle,
    type: 'baseCampaignEdge',
    reconnectable: true,
    ...(isHorizontal
      ? { markerStart: undefined, markerEnd: undefined }
      : {
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 12,
            height: 12,
            color: '#4b5563',
          },
          markerStart: undefined,
        }),
    data: {
      ...(options.oldEdge?.data ?? {}),
      data_mapping:
        options.oldEdge?.data?.data_mapping ?? ([] as DataMappingList),
      isFeedback,
      isOrthogonal,
      isDependencyEdge:
        options.isDependencyEdge ??
        isExecutableCampaignConnection(connection, nodes),
      horizontalDirection,
    },
  }
}
