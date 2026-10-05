import React, { useState } from 'react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  Position,
  type EdgeProps,
  useReactFlow,
} from '@xyflow/react'
import { ActionIcon, Group, Text, Tooltip } from '@mantine/core'
import { IHubIconCheck, IHubIconTrash, IHubIconX } from '@ihub/utils/icons'

import { useCampaignView } from '../state/campaignViewContext'
import classes from './style.module.css'

const tooltipEvents = { hover: true, focus: true, touch: false } as const

function hashToLane(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0
  }

  // Deterministic lanes in range [-2, 2].
  return (Math.abs(hash) % 5) - 2
}

export default function BaseCampaignEdge(props: EdgeProps) {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    markerStart,
    markerEnd,
    selected,
    deletable,
  } = props
  const [isHovered, setIsHovered] = useState(false)
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false)
  const { deleteElements } = useReactFlow()
  const { readOnly } = useCampaignView()

  const edgeData = (props.data ?? {}) as {
    isFeedback?: boolean
    isOrthogonal?: boolean
    isDependencyEdge?: boolean
    horizontalDirection?: 'left' | 'right'
  }

  const isHorizontalRoute =
    (sourcePosition === Position.Right && targetPosition === Position.Left) ||
    (sourcePosition === Position.Left && targetPosition === Position.Right)

  // For horizontal links, prefer drag intent captured at connect time.
  const horizontalDirection =
    edgeData.horizontalDirection ?? (targetX >= sourceX ? 'right' : 'left')

  const isHorizontalDirectional = isHorizontalRoute

  const isVerticalHandleRoute =
    (sourcePosition === Position.Top || sourcePosition === Position.Bottom) &&
    (targetPosition === Position.Top || targetPosition === Position.Bottom)

  const shouldOffsetLane =
    edgeData.isFeedback === true ||
    edgeData.isOrthogonal === true ||
    isVerticalHandleRoute

  const lane = shouldOffsetLane ? hashToLane(id) : 0
  const laneSpacing = 26
  const laneOffsetX = lane * laneSpacing
  const centerX = (sourceX + targetX) / 2 + laneOffsetX
  const routeOffset = 20 + Math.abs(lane) * 6

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    centerX,
    offset: routeOffset,
    borderRadius: 16,
  })

  const edgeStyle = { stroke: '#868686', strokeWidth: 2 }
  const canDelete = !readOnly && deletable !== false
  let arrow: React.ReactNode = null

  if (isHorizontalDirectional) {
    const arrowLength = 10
    const arrowHalfHeight = 6
    const isDependencyEdge = edgeData.isDependencyEdge === true
    const isRightward = isDependencyEdge
      ? targetPosition === Position.Left
      : horizontalDirection === 'right'

    const arrowTipX = isDependencyEdge
      ? targetX
      : isRightward
        ? targetX
        : sourceX
    const arrowTipY = isDependencyEdge
      ? targetY
      : isRightward
        ? targetY
        : sourceY
    const arrowBaseX = isRightward
      ? arrowTipX - arrowLength
      : arrowTipX + arrowLength

    arrow = (
      <path
        d={`M ${arrowTipX} ${arrowTipY} L ${arrowBaseX} ${arrowTipY - arrowHalfHeight} L ${arrowBaseX} ${arrowTipY + arrowHalfHeight} Z`}
        fill='#4b5563'
        stroke='#4b5563'
        strokeWidth={1}
      />
    )
  }

  return (
    <>
      <g
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <BaseEdge
          id={id}
          path={edgePath}
          style={edgeStyle}
          markerStart={isHorizontalDirectional ? undefined : markerStart}
          markerEnd={isHorizontalDirectional ? undefined : markerEnd}
          interactionWidth={20}
        />
        {arrow}
      </g>
      {canDelete && (
        <EdgeLabelRenderer>
          <div
            className={`${classes.baseEdgeLabel} ${
              isHovered || selected || isConfirmingDelete
                ? classes.baseEdgeLabelVisible
                : ''
            } nodrag nopan`}
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
          >
            {isConfirmingDelete ? (
              <Group
                className={classes.baseEdgeConfirmation}
                gap={4}
                px='xs'
                wrap='nowrap'
              >
                <Text size='sm'>Delete edge?</Text>
                <Tooltip label='Confirm delete edge' events={tooltipEvents}>
                  <ActionIcon
                    variant='subtle'
                    color='red'
                    aria-label='Confirm delete edge'
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation()
                      void deleteElements({ edges: [{ id }] })
                    }}
                  >
                    <IHubIconCheck size={16} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label='Cancel delete edge' events={tooltipEvents}>
                  <ActionIcon
                    variant='subtle'
                    color='gray'
                    aria-label='Cancel delete edge'
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation()
                      setIsConfirmingDelete(false)
                    }}
                  >
                    <IHubIconX size={16} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            ) : (
              <Tooltip label='Delete edge' events={tooltipEvents}>
                <ActionIcon
                  className={classes.baseEdgeDeleteButton}
                  variant='subtle'
                  color='gray'
                  radius='xl'
                  aria-label='Delete edge'
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation()
                    setIsConfirmingDelete(true)
                  }}
                >
                  <IHubIconTrash size={16} />
                </ActionIcon>
              </Tooltip>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
