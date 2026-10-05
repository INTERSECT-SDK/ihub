import { useCallback, useEffect, useRef, useState } from 'react'
import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react'
import {
  ActionIcon,
  Button,
  Card,
  CardSection,
  Group,
  Menu,
  Text,
  Tooltip,
} from '@mantine/core'
import {
  IHubIconHide,
  IHubIconMore,
  IHubIconShow,
  IHubIconTrash,
  IHubIconX,
} from '@ihub/utils/icons'
import nodeStyles from './style.module.css'
import {
  useNodeExecutionRunCount,
  useNodeExecutionStatus,
} from '../../state/executionContext'
import NodeStatusBadge from './NodeStatusBadge'
import { NodeActionsMenu } from './NodeActionsMenu'
import type { NodeActionDescriptor } from './nodeActions'
import { useCampaignView } from '../../state/campaignViewContext'
import { useCampaignNodeRenderSettings } from '../../editor/CampaignNodeRenderContext'

const tooltipEvents = { hover: true, focus: true, touch: false } as const

type BaseNodeProps = {
  id: string
  title: React.ReactNode
  subtitle?: React.ReactNode
  dropdown?: React.ReactNode
  actions?: NodeActionDescriptor[]
  onDelete?: () => void
  deleteTarget?: 'node' | 'task group'
  tags: React.ReactNode
  children?: React.ReactNode
  style?: React.CSSProperties
  onView?: () => void
  hasInputs?: boolean
  hasOutputs?: boolean
  outputPositions?: Position | Position[]
  handleColor?: string
  onMouseEnter?: React.MouseEventHandler<HTMLDivElement>
  onMouseLeave?: React.MouseEventHandler<HTMLDivElement>
}

export default function BaseNode({
  id,
  title,
  subtitle,
  dropdown,
  actions,
  onDelete,
  deleteTarget = 'node',
  tags,
  children,
  style,
  onView,
  hasInputs = true,
  hasOutputs = true,
  outputPositions,
  handleColor = '#3b82f6',
  ...rest
}: BaseNodeProps) {
  const [showPanelState, setShowPanelState] = useState(false)
  const renderSettings = useCampaignNodeRenderSettings()
  const { readOnly } = useCampaignView()
  const nodeStatus = useNodeExecutionStatus(id)
  const nodeRunCount = useNodeExecutionRunCount(id)
  const updateNodeInternals = useUpdateNodeInternals()
  const cardRef = useRef<HTMLDivElement>(null)
  const stopReactFlowInteraction = useCallback(
    (event: React.SyntheticEvent) => {
      event.stopPropagation()
    },
    [],
  )
  const deleteAction: NodeActionDescriptor | null = onDelete
    ? {
        id: 'delete',
        label: `Delete ${deleteTarget}`,
        tooltip: `Delete ${deleteTarget}`,
        icon: <IHubIconTrash size={16} />,
        confirmation: {
          prompt: `Delete ${deleteTarget}?`,
          confirmLabel: `Confirm delete ${deleteTarget}`,
          cancelLabel: `Cancel delete ${deleteTarget}`,
          onConfirm: onDelete,
        },
      }
    : null
  const mutableNodeActions = deleteAction
    ? [...(actions ?? []), deleteAction]
    : actions
  const nodeActions = mutableNodeActions?.map((action) => ({
    ...action,
    disabled: action.disabled || readOnly,
  }))
  const canExpand = Boolean(children) && !onView
  const nodeHeight = showPanelState ? style?.height || '380px' : '120px'

  useEffect(() => {
    if (!canExpand) return

    const cardElement = cardRef.current
    const updateHandles = () => updateNodeInternals(id)
    const handleHeightTransitionEnd = (event: TransitionEvent) => {
      if (event.target === cardElement && event.propertyName === 'height') {
        updateHandles()
      }
    }
    cardElement?.addEventListener('transitionend', handleHeightTransitionEnd)
    updateHandles()

    return () => {
      cardElement?.removeEventListener(
        'transitionend',
        handleHeightTransitionEnd,
      )
    }
  }, [canExpand, id, showPanelState, updateNodeInternals])

  if (renderSettings.mode === 'inspector') {
    return (
      <div className={nodeStyles.inspectorNode}>
        {renderSettings.onBack && (
          <Button
            variant='subtle'
            size='compact-xs'
            onClick={renderSettings.onBack}
          >
            {renderSettings.backLabel ?? 'Back to Nodes List'}
          </Button>
        )}
        <div className={nodeStyles.inspectorHeader}>
          <div className={nodeStyles.inspectorHeadingGroup}>
            <Text
              ref={renderSettings.headingRef}
              component='h2'
              tabIndex={-1}
              size='md'
              fw={600}
              className={nodeStyles.inspectorHeading}
            >
              {title}
            </Text>
            {subtitle && <Text size='xs'>{subtitle}</Text>}
          </div>
          <Group gap='xs' wrap='nowrap'>
            {nodeActions && <NodeActionsMenu actions={nodeActions} />}
            <ActionIcon
              variant='subtle'
              color='gray'
              aria-label='Close node inspector'
              onClick={renderSettings.onClose}
            >
              <IHubIconX size={16} />
            </ActionIcon>
          </Group>
        </div>
        <Group className={nodeStyles.inspectorTags} gap='xs'>
          {tags}
          <NodeStatusBadge status={nodeStatus} runCount={nodeRunCount} />
        </Group>
        <div className={nodeStyles.inspectorContent}>{children}</div>
      </div>
    )
  }

  return (
    <div
      className={`${nodeStyles.nodeWrapper} nowheel`}
      style={
        {
          '--handle-color': handleColor,
        } as React.CSSProperties & { '--handle-color': string }
      }
    >
      <Card
        ref={cardRef}
        withBorder
        shadow='sm'
        radius='md'
        p='md'
        style={{
          ...style,
          height: nodeHeight,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          transition: 'height 0.3s ease',
        }}
        {...rest}
      >
        <CardSection withBorder inheritPadding py='xs'>
          <Group
            justify='space-between'
            wrap='nowrap'
            className={nodeStyles.canvasHeader}
          >
            <div className={nodeStyles.canvasHeadingGroup}>
              <Text size='sm' fw={500} component='span'>
                {title}
              </Text>
              <Text
                size='xs'
                fw={200}
                className={
                  showPanelState ? undefined : nodeStyles.collapsedSubtitle
                }
                title={
                  !showPanelState && typeof subtitle === 'string'
                    ? subtitle
                    : undefined
                }
              >
                {subtitle}
              </Text>
            </div>
            {(onView || canExpand || nodeActions || dropdown) && (
              <Group
                m={0}
                p={0}
                className={`${nodeStyles.canvasHeaderActions} nodrag nopan nowheel`}
                onClick={stopReactFlowInteraction}
                onPointerDown={stopReactFlowInteraction}
                onMouseDown={stopReactFlowInteraction}
                onTouchStart={stopReactFlowInteraction}
                onWheel={stopReactFlowInteraction}
              >
                {onView ? (
                  <Tooltip label='Open canvas' events={tooltipEvents}>
                    <ActionIcon
                      variant='subtle'
                      color='gray'
                      aria-label='Open canvas'
                      onClick={onView}
                    >
                      <IHubIconShow size={16} />
                    </ActionIcon>
                  </Tooltip>
                ) : canExpand ? (
                  <Tooltip
                    label={
                      showPanelState
                        ? 'Collapse node details'
                        : 'Expand node details'
                    }
                    events={tooltipEvents}
                  >
                    <ActionIcon
                      variant='subtle'
                      color='gray'
                      aria-label={
                        showPanelState
                          ? 'Collapse node details'
                          : 'Expand node details'
                      }
                      aria-expanded={showPanelState}
                      onClick={() => setShowPanelState((visible) => !visible)}
                    >
                      {showPanelState ? (
                        <IHubIconHide size={16} />
                      ) : (
                        <IHubIconShow size={16} />
                      )}
                    </ActionIcon>
                  </Tooltip>
                ) : null}
                {nodeActions ? (
                  <NodeActionsMenu actions={nodeActions} />
                ) : dropdown ? (
                  <Menu shadow='md'>
                    <Menu.Target>
                      <ActionIcon
                        variant='subtle'
                        color='gray'
                        aria-label='Open node actions'
                      >
                        <IHubIconMore size={16} />
                      </ActionIcon>
                    </Menu.Target>
                    {dropdown}
                  </Menu>
                ) : null}
              </Group>
            )}
          </Group>
        </CardSection>
        {canExpand && showPanelState && (
          <Card.Section
            key='card-content'
            className='nodrag nopan nowheel'
            withBorder
            inheritPadding
            py='xs'
            style={{ flex: 1, overflow: 'auto', minHeight: 0, cursor: 'auto' }}
            onClick={stopReactFlowInteraction}
            onPointerDown={stopReactFlowInteraction}
            onMouseDown={stopReactFlowInteraction}
            onTouchStart={stopReactFlowInteraction}
            onWheel={stopReactFlowInteraction}
          >
            {children}
          </Card.Section>
        )}
        <CardSection
          key='card-tags'
          withBorder
          p='xs'
          display='flex'
          className={nodeStyles.nodeTags}
        >
          {tags}
          <NodeStatusBadge status={nodeStatus} runCount={nodeRunCount} />
        </CardSection>
      </Card>
      {hasInputs && (
        <>
          <Handle
            type='target'
            position={Position.Left}
            id='input-left'
            className={nodeStyles.primaryHandle}
            data-handlepos='left'
          />
          {/* <Handle
            type='source'
            position={Position.Top}
            id='top'
            className={nodeStyles.secondaryHandle}
            data-handlepos='top'
          /> */}
        </>
      )}
      {hasOutputs && (
        <>
          {(() => {
            const positions = outputPositions
              ? Array.isArray(outputPositions)
                ? outputPositions
                : [outputPositions]
              : [Position.Right, Position.Bottom]
            return positions.map((pos) => (
              <Handle
                key={`output-${pos}`}
                type='source'
                position={pos}
                id={`output-${pos.toLowerCase()}`}
                className={
                  pos === Position.Right
                    ? nodeStyles.primaryHandle
                    : nodeStyles.secondaryHandle
                }
                data-handlepos={pos.toLowerCase()}
              />
            ))
          })()}
        </>
      )}
    </div>
  )
}
