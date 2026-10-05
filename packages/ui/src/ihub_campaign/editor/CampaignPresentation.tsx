'use client'

import { Position } from '@xyflow/react'
import type {
  Broker,
  Capability,
  CampaignObjectiveAssert,
  CampaignObjectiveIterate,
  CampaignObjectiveThreshold,
  CampaignModel,
  CampaignTaskGroup,
  Service,
} from '@ihub/utils/types/campaign'
import type { JupyterServerConfig } from '@ihub/utils/types/notebook'
import {
  Badge,
  Button,
  Collapse,
  type ComboboxData,
  Group,
  Input,
  Menu,
  NumberInput,
  Paper,
  Select,
  Text,
} from '@mantine/core'
import useSWR from 'swr'
import {
  type CSSProperties,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

import * as classes from './styles.module.css'
import BaseNode from '../nodes/common/BaseNode'
import { CampaignBrokerSelector } from './CampaignBrokerSelector'
import { TopMenuButton } from '../../navigation/TopMenuButton'
import { PlotlyVisualizationRegistry } from '../../ihub_visualization/plotly_components/plotlyRegistry'
import { RendererRegistry } from '../../ihub_visualization/RegisteredRenderers'
import { IHubIconChevronRight, IHubIconPlus } from '@ihub/utils/icons'
import {
  useCampaignDisplayNodeRunCounts,
  useCampaignDisplayNodeStatuses,
  type NodeStatus,
} from '../state/executionContext'
import {
  aggregateTaskGroupStatus,
  getExecutableCampaignTasks,
  getTaskGroupIteration,
  type CampaignModelTab,
} from '../model/selectors'
import {
  decodeObjectiveVariableOptionValue,
  encodeObjectiveVariableOptionValue,
  getThresholdTargetBounds,
  isObjectiveIterate,
  normalizeThresholdTarget,
  type UnifiedObjectiveEntry,
  type UnifiedObjectiveKind,
} from '../model/objectiveOperations'
type CampaignTaskGroupNodeData = CampaignTaskGroup & {
  displayLabel: string
}

type SlidingMenuLabelStyle = CSSProperties & {
  '--menu-label-overflow'?: string
  '--menu-label-slide-duration'?: string
}

function SlidingMenuLabel({ children }: { children: string }) {
  const containerRef = useRef<HTMLSpanElement>(null)
  const contentRef = useRef<HTMLSpanElement>(null)
  const [overflowDistance, setOverflowDistance] = useState(0)

  useLayoutEffect(() => {
    const container = containerRef.current
    const content = contentRef.current

    if (!container || !content) return

    const updateOverflowDistance = () => {
      setOverflowDistance(
        Math.max(0, content.scrollWidth - container.clientWidth),
      )
    }
    const resizeObserver = new ResizeObserver(updateOverflowDistance)

    updateOverflowDistance()
    resizeObserver.observe(container)
    resizeObserver.observe(content)

    return () => resizeObserver.disconnect()
  }, [children])

  const style: SlidingMenuLabelStyle =
    overflowDistance > 0
      ? {
          '--menu-label-overflow': `${overflowDistance}px`,
          '--menu-label-slide-duration': `${Math.max(2, overflowDistance / 35)}s`,
        }
      : {}

  return (
    <span
      ref={containerRef}
      className={classes.slidingMenuLabel}
      data-overflowing={overflowDistance > 0 ? 'true' : 'false'}
      style={style}
      title={overflowDistance > 0 ? children : undefined}
    >
      <span ref={contentRef} className={classes.slidingMenuLabelContent}>
        {children}
      </span>
    </span>
  )
}

function getNodeStatusBadgeColor(status: NodeStatus): string {
  if (status === 'waiting') return 'gray'
  if (status === 'executing') return 'yellow'
  if (status === 'complete') return 'green'
  if (status === 'error' || status === 'aborted') return 'red'
  return 'gray'
}

export function getNodeStatusBadgeLabel(status: NodeStatus): string {
  if (status === 'waiting') return 'Waiting'
  if (status === 'executing') return 'Executing'
  if (status === 'complete') return 'Complete'
  if (status === 'error') return 'Error'
  if (status === 'aborted') return 'Aborted'
  return 'Idle'
}

type CampaignSheetTabsProps = {
  campaignModel: CampaignModel
  tabs: CampaignModelTab[]
  selectedSheetId: string
  masterSheetId: string
  nodeStatuses: Record<string, NodeStatus>
  nodeRunCounts: Record<string, number>
  addTaskGroupDisabled: boolean
  onSelectSheet: (sheetId: string) => void
  onAddTaskGroup: () => void
}

/** Renders campaign and task-group tabs with their current run status. */
export function CampaignSheetTabs({
  campaignModel,
  tabs,
  selectedSheetId,
  masterSheetId,
  nodeStatuses,
  nodeRunCounts,
  addTaskGroupDisabled,
  onSelectSheet,
  onAddTaskGroup,
}: CampaignSheetTabsProps) {
  return (
    <div className={classes.campaignSheetsBar}>
      <Button
        className={classes.campaignSheetTab}
        data-selected={selectedSheetId === masterSheetId}
        onClick={() => onSelectSheet(masterSheetId)}
      >
        Campaign
      </Button>

      <div
        className={classes.campaignSheetDivider}
        role='separator'
        aria-orientation='vertical'
      />

      <div className={classes.campaignTaskGroupsSection}>
        {tabs
          .filter((tab) => tab.id !== masterSheetId)
          .map((tab) => {
            const isSelected = tab.id === selectedSheetId
            const taskGroup = campaignModel.task_groups.find(
              (group) => group.id === tab.id,
            )
            const taskGroupStatus = taskGroup
              ? aggregateTaskGroupStatus(taskGroup, nodeStatuses)
              : 'idle'
            const taskGroupIteration = taskGroup
              ? getTaskGroupIteration(taskGroup, nodeRunCounts)
              : 0
            const taskGroupStatusLabel = `${getNodeStatusBadgeLabel(taskGroupStatus)}${
              taskGroupIteration > 0 ? ` · Iteration ${taskGroupIteration}` : ''
            }`

            return (
              <Button
                key={tab.id}
                className={classes.campaignSheetTab}
                data-selected={isSelected ? 'true' : 'false'}
                onClick={() => onSelectSheet(tab.id)}
              >
                <Group
                  gap={8}
                  wrap='nowrap'
                  className={classes.campaignSheetTabContent}
                >
                  <span>{tab.label}</span>
                  {taskGroupStatus !== 'idle' && (
                    <span
                      className={classes.taskGroupTabStatusIndicator}
                      data-status={taskGroupStatus}
                      aria-label={`Task group status: ${taskGroupStatusLabel}`}
                      title={taskGroupStatusLabel}
                    />
                  )}
                  {taskGroupIteration > 0 && (
                    <span className={classes.taskGroupTabIteration}>
                      Iteration {taskGroupIteration}
                    </span>
                  )}
                </Group>
              </Button>
            )
          })}

        <Button
          className={classes.addTaskGroupButton}
          onClick={onAddTaskGroup}
          disabled={addTaskGroupDisabled}
        >
          + Task Group
        </Button>
      </div>
    </div>
  )
}

export function CampaignTaskGroupNode({
  id,
  data,
  onOpen,
  onDelete,
}: {
  id: string
  data: CampaignTaskGroupNodeData
  onOpen: () => void
  onDelete: () => void
}) {
  const taskGroupTypeColor = '#212528'
  const nodeStatuses = useCampaignDisplayNodeStatuses()
  const nodeRunCounts = useCampaignDisplayNodeRunCounts()
  const taskGroupStatus = aggregateTaskGroupStatus(data, nodeStatuses)
  const taskGroupIteration = getTaskGroupIteration(data, nodeRunCounts)
  const executableTasks = getExecutableCampaignTasks(data)
  const totalTasks = executableTasks.length
  const completedCount = executableTasks.filter(
    (task) => nodeStatuses[task.id] === 'complete',
  ).length
  const executingTaskIndex = executableTasks.findIndex(
    (task) => nodeStatuses[task.id] === 'executing',
  )

  const subtitle =
    taskGroupStatus === 'executing' && executingTaskIndex >= 0
      ? `Iteration ${taskGroupIteration} · Running step ${executingTaskIndex + 1} of ${totalTasks}`
      : taskGroupStatus === 'waiting'
        ? `Waiting (${completedCount}/${totalTasks} complete)`
        : taskGroupStatus === 'complete'
          ? `Completed ${completedCount}/${totalTasks} steps`
          : taskGroupStatus === 'error'
            ? `Errored at ${completedCount}/${totalTasks} complete`
            : taskGroupStatus === 'aborted'
              ? `Aborted at ${completedCount}/${totalTasks} complete`
              : `Tasks: ${totalTasks}`

  return (
    <BaseNode
      id={id}
      title={
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <div style={{ fontWeight: 600 }}>{data.displayLabel}</div>
        </span>
      }
      subtitle={subtitle}
      onDelete={onDelete}
      deleteTarget='task group'
      tags={
        <Group gap={6} wrap='nowrap'>
          <Badge
            key='task-group-tag'
            h={20}
            size='xs'
            color={taskGroupTypeColor}
          >
            Task Group
          </Badge>
          {taskGroupStatus !== 'idle' && (
            <Badge
              key='task-group-status-tag'
              h={20}
              size='xs'
              color={getNodeStatusBadgeColor(taskGroupStatus)}
            >
              {getNodeStatusBadgeLabel(taskGroupStatus)}
              {taskGroupIteration > 0 && ` · Iteration ${taskGroupIteration}`}
            </Badge>
          )}
        </Group>
      }
      onView={onOpen}
      hasInputs
      hasOutputs
      handleColor={taskGroupTypeColor}
      style={{ border: `1px solid ${taskGroupTypeColor}` }}
      outputPositions={Position.Right}
    />
  )
}

type CapabilityTaskMenuProps = {
  intersectId: string | null
  selectedTaskGroupId: string | null
  projectId?: string
  jupyterServers?: JupyterServerConfig[]
  addCapabilityTask: (capability: Capability, endpoint: string) => void
  addEventTask: (capability: Capability, eventName: string) => void
  addJsonFileTask: () => void
  addJsonTextTask: () => void
  addVisualizationTask: (
    visualizationType: string,
    visualizationName: string,
  ) => void
  addRendererTask: (rendererType: string, rendererName: string) => void
}

export function CapabilityTaskMenu({
  intersectId,
  selectedTaskGroupId,
  projectId,
  jupyterServers,
  addCapabilityTask,
  addEventTask,
  addJsonFileTask,
  addJsonTextTask,
  addVisualizationTask,
  addRendererTask,
}: CapabilityTaskMenuProps) {
  const [menuOpened, setMenuOpened] = useState(false)
  const menuTargetRef = useRef<HTMLSpanElement>(null)
  const menuDropdownRef = useRef<HTMLDivElement>(null)
  const [submenuPortalTarget, setSubmenuPortalTarget] =
    useState<HTMLDivElement | null>(null)
  const { data: listOfServicesData } = useSWR(
    intersectId ? `/api/v1/services/${intersectId}` : null,
    (url: string) => fetch(url).then((res) => (res.ok ? res.json() : [])),
  )
  const services = [...((listOfServicesData ?? []) as Service[])].sort((a, b) =>
    a.name.localeCompare(b.name),
  )

  const disabled = !selectedTaskGroupId
  const hoverInfo = selectedTaskGroupId
    ? 'Add task or source node'
    : 'Open a task group tab first'

  useEffect(() => {
    if (!menuOpened) return

    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      const eventPath = event.composedPath()
      const target = menuTargetRef.current
      const dropdown = menuDropdownRef.current

      if (
        (!target || !eventPath.includes(target)) &&
        (!dropdown || !eventPath.includes(dropdown))
      ) {
        setMenuOpened(false)
      }
    }

    document.addEventListener('pointerdown', closeOnOutsidePointerDown, true)
    return () =>
      document.removeEventListener(
        'pointerdown',
        closeOnOutsidePointerDown,
        true,
      )
  }, [menuOpened])

  return (
    <Menu
      shadow='md'
      width={320}
      position='bottom-start'
      openDelay={100}
      closeDelay={200}
      opened={menuOpened}
      onChange={setMenuOpened}
      withinPortal={false}
      closeOnClickOutside
    >
      <Menu.Target>
        <span ref={menuTargetRef}>
          <TopMenuButton
            Icon={IHubIconPlus}
            hoverInfo={hoverInfo}
            onClick={() => setMenuOpened((open) => !open)}
            disabled={disabled}
            showTooltipWhenDisabled
          />
        </span>
      </Menu.Target>
      <Menu.Dropdown
        ref={menuDropdownRef}
        className={classes.addNodeMenuDropdown}
      >
        <div className={classes.addNodeMenuScrollArea}>
          <Menu.Label>Services</Menu.Label>
          {intersectId ? (
            services.map((service) => (
              <CapabilityServiceMenu
                key={`model-service-${service.id}`}
                service={service}
                portalTarget={submenuPortalTarget}
                onSelectEndpoint={(capability, endpoint) => {
                  addCapabilityTask(capability, endpoint)
                  setMenuOpened(false)
                }}
                onSelectEvent={(capability, eventName) => {
                  addEventTask(capability, eventName)
                  setMenuOpened(false)
                }}
              />
            ))
          ) : (
            <Menu.Item disabled>
              Select an INTERSECT server to load services.
            </Menu.Item>
          )}
          {intersectId && services.length === 0 && (
            <Menu.Item disabled>
              No services available for this server.
            </Menu.Item>
          )}
          <Menu.Divider />
          <Menu.Label>Inputs</Menu.Label>
          <Menu.Item
            disabled={!projectId || !jupyterServers?.length}
            onClick={() => {
              addJsonFileTask()
              setMenuOpened(false)
            }}
          >
            JSON File
          </Menu.Item>
          <Menu.Item
            disabled={!selectedTaskGroupId}
            onClick={() => {
              addJsonTextTask()
              setMenuOpened(false)
            }}
          >
            JSON Text
          </Menu.Item>
          <Menu.Divider />
          <Menu.Label>Renderers</Menu.Label>
          <Menu
            withinPortal
            portalProps={{ target: submenuPortalTarget ?? undefined }}
            floatingStrategy='fixed'
            trigger='click'
            position='right-start'
          >
            <Menu.Target>
              <div className={classes.addNodeMenuItem}>
                <Group justify='space-between' w='100%' wrap='nowrap'>
                  <SlidingMenuLabel>Visualizations</SlidingMenuLabel>
                  <IHubIconChevronRight size={14} />
                </Group>
              </div>
            </Menu.Target>
            <Menu.Dropdown className={classes.boundedMenuDropdown}>
              {PlotlyVisualizationRegistry.map((visualization) => (
                <Menu.Item
                  key={`model-visualization-${visualization.type}`}
                  onClick={() => {
                    addVisualizationTask(visualization.type, visualization.name)
                    setMenuOpened(false)
                  }}
                >
                  <SlidingMenuLabel>{visualization.name}</SlidingMenuLabel>
                </Menu.Item>
              ))}
            </Menu.Dropdown>
            {RendererRegistry.map((renderer) => (
              <Menu.Item
                key={`model-renderer-${renderer.type}`}
                onClick={() => {
                  addRendererTask(renderer.type, renderer.name)
                  setMenuOpened(false)
                }}
              >
                <SlidingMenuLabel>{renderer.name}</SlidingMenuLabel>
              </Menu.Item>
            ))}
          </Menu>
        </div>
        <div ref={setSubmenuPortalTarget} />
      </Menu.Dropdown>
    </Menu>
  )
}

type TaskGroupObjectivesEditorProps = {
  taskGroupLabel: string
  accentColor: string
  objectives: UnifiedObjectiveEntry[]
  assertVariableOptions: ComboboxData
  thresholdVariableOptions: ComboboxData
  onAddObjective: () => void
  onChangeObjectiveKind: (
    objectiveId: string,
    scope: UnifiedObjectiveEntry['scope'],
    kind: UnifiedObjectiveKind,
  ) => void
  onUpdateAssertObjective: (
    objectiveId: string,
    patch: Partial<CampaignObjectiveAssert>,
  ) => void
  onUpdateIterateObjective: (
    objectiveId: string,
    patch: Partial<CampaignObjectiveIterate>,
  ) => void
  onUpdateThresholdObjective: (
    objectiveId: string,
    patch: Partial<CampaignObjectiveThreshold>,
  ) => void
  onRemoveObjective: (
    objectiveId: string,
    scope: UnifiedObjectiveEntry['scope'],
  ) => void
}

type CampaignOnboardingProps = {
  brokers: Broker[] | undefined
  intersectId: string | null
  setIntersectId: (intersectId: string | null) => void
  onCreateTaskGroup: () => void
  isBrokerSelectionLocked?: boolean
}

export function CampaignOnboarding({
  brokers,
  intersectId,
  setIntersectId,
  onCreateTaskGroup,
  isBrokerSelectionLocked = false,
}: CampaignOnboardingProps) {
  return (
    <Paper
      className={classes.campaignOnboarding}
      withBorder
      shadow='sm'
      role='region'
      aria-label='Campaign setup'
    >
      <Text fw={600} size='lg'>
        Set up your campaign
      </Text>
      <Text size='sm' c='dimmed'>
        Choose where this campaign will run, then create its first task group.
      </Text>

      <div
        className={classes.campaignOnboardingStep}
        data-complete={Boolean(intersectId)}
      >
        <Badge size='sm' variant={intersectId ? 'filled' : 'light'}>
          1
        </Badge>
        <div className={classes.campaignOnboardingStepContent}>
          <Text fw={500} size='sm'>
            Select an INTERSECT instance
          </Text>
          <Text size='xs' c='dimmed' mb={6}>
            Capabilities and services will be loaded from this instance.
          </Text>
          <CampaignBrokerSelector
            brokers={brokers}
            intersectId={intersectId}
            setIntersectId={setIntersectId}
            width='100%'
            disabled={isBrokerSelectionLocked}
          />
        </div>
      </div>

      <div
        className={classes.campaignOnboardingStep}
        data-active={Boolean(intersectId)}
      >
        <Badge size='sm' variant={intersectId ? 'light' : 'outline'}>
          2
        </Badge>
        <div className={classes.campaignOnboardingStepContent}>
          <Text fw={500} size='sm'>
            Create your first task group
          </Text>
          <Text size='xs' c='dimmed' mb={8}>
            Task groups organize the tasks that run together.
          </Text>
          <Button size='xs' onClick={onCreateTaskGroup} disabled={!intersectId}>
            Create first task group
          </Button>
        </div>
      </div>
    </Paper>
  )
}

export function TaskGroupObjectivesEditor({
  taskGroupLabel,
  accentColor,
  objectives,
  assertVariableOptions,
  thresholdVariableOptions,
  onAddObjective,
  onChangeObjectiveKind,
  onUpdateAssertObjective,
  onUpdateIterateObjective,
  onUpdateThresholdObjective,
  onRemoveObjective,
}: TaskGroupObjectivesEditorProps) {
  const [expanded, setExpanded] = useState(false)
  const panelStyle: CSSProperties = {
    '--task-group-accent': accentColor,
  } as CSSProperties

  const handleAddObjective = () => {
    onAddObjective()
    setExpanded(true)
  }

  return (
    <Paper
      className={classes.taskGroupObjectivesPanel}
      data-expanded={expanded}
      style={panelStyle}
    >
      <Group justify='space-between' align='center' gap='xs' wrap='nowrap'>
        <button
          type='button'
          className={classes.taskGroupObjectivesToggle}
          aria-expanded={expanded}
          aria-controls='task-group-objectives-content'
          onClick={() => setExpanded((current) => !current)}
        >
          <IHubIconChevronRight
            size={13}
            className={classes.taskGroupObjectivesChevron}
          />
          <Text component='span' fw={500} size='xs'>
            {taskGroupLabel} objectives
          </Text>
          <Badge size='xs' variant='light' color='gray'>
            {objectives.length}
          </Badge>
        </button>

        <Group gap={4}>
          <Button
            size='compact-xs'
            variant='subtle'
            onClick={handleAddObjective}
          >
            + Objective
          </Button>
        </Group>
      </Group>

      <Collapse in={expanded}>
        <div id='task-group-objectives-content'>
          {objectives.length === 0 ? (
            <Text size='xs' c='dimmed' mt='xs'>
              No objectives configured yet.
            </Text>
          ) : (
            <div className={classes.taskGroupObjectivesList}>
              {objectives.map((entry, index) => {
                const isThreshold = entry.scope === 'threshold'
                const isIterate =
                  entry.scope === 'task_group' &&
                  isObjectiveIterate(entry.objective)
                const objectiveKind: UnifiedObjectiveKind = isThreshold
                  ? entry.objective.type
                  : isIterate
                    ? 'iterate'
                    : 'assert'
                const objectiveId = entry.objective.id
                const assertObjective =
                  entry.scope === 'task_group' &&
                  !isObjectiveIterate(entry.objective)
                    ? entry.objective
                    : null
                const thresholdObjective =
                  entry.scope === 'threshold' ? entry.objective : null

                return (
                  <div
                    key={objectiveId}
                    className={classes.taskGroupObjectiveItem}
                  >
                    <Group justify='space-between' align='flex-start' gap='xs'>
                      <Group gap={8} align='center'>
                        <Badge
                          size='xs'
                          variant='light'
                          style={{
                            borderColor: accentColor,
                            color: accentColor,
                          }}
                        >
                          Objective {index + 1}
                        </Badge>
                        <Select
                          size='xs'
                          w={145}
                          data={[
                            { value: 'assert', label: 'Assert' },
                            { value: 'iterate', label: 'Iterate' },
                            { value: 'upper_limit', label: 'Upper Limit' },
                            { value: 'range', label: 'Range' },
                          ]}
                          value={objectiveKind}
                          onChange={(value) => {
                            if (
                              value === 'assert' ||
                              value === 'iterate' ||
                              value === 'upper_limit' ||
                              value === 'range'
                            ) {
                              onChangeObjectiveKind(
                                objectiveId,
                                entry.scope,
                                value,
                              )
                            }
                          }}
                          aria-label={`Objective ${index + 1} type`}
                        />
                      </Group>

                      <Button
                        size='compact-xs'
                        variant='subtle'
                        color='red'
                        onClick={() =>
                          onRemoveObjective(objectiveId, entry.scope)
                        }
                      >
                        Remove
                      </Button>
                    </Group>

                    {objectiveKind === 'iterate' ? (
                      <Group mt='xs' gap='xs' align='flex-end' wrap='wrap'>
                        <Input.Wrapper
                          label='Iterations'
                          className={classes.objectiveFieldSmall}
                        >
                          <NumberInput
                            size='xs'
                            min={1}
                            step={1}
                            value={
                              entry.scope === 'task_group' &&
                              isObjectiveIterate(entry.objective)
                                ? entry.objective.iterations
                                : 1
                            }
                            onChange={(value) => {
                              const parsed =
                                typeof value === 'number'
                                  ? value
                                  : Number.parseInt(String(value), 10)
                              onUpdateIterateObjective(objectiveId, {
                                iterations: Number.isFinite(parsed)
                                  ? Math.max(1, parsed)
                                  : 1,
                              })
                            }}
                            aria-label={`Objective ${index + 1} iterations`}
                          />
                        </Input.Wrapper>
                      </Group>
                    ) : objectiveKind === 'assert' ? (
                      <Group mt='xs' gap='xs' align='flex-end' wrap='wrap'>
                        <Input.Wrapper
                          label='Variable'
                          className={classes.objectiveFieldMedium}
                        >
                          {(() => {
                            const matchingOptionValue = assertVariableOptions
                              .flatMap((option) => {
                                if (typeof option === 'string') {
                                  return [option]
                                }

                                if ('items' in option) {
                                  return option.items.flatMap((item) =>
                                    typeof item === 'string'
                                      ? [item]
                                      : [item.value],
                                  )
                                }

                                return [option.value]
                              })
                              .find(
                                (optionValue) =>
                                  decodeObjectiveVariableOptionValue(
                                    optionValue,
                                  ) === (assertObjective?.var ?? ''),
                              )

                            const availableVariableOptions: ComboboxData =
                              (assertObjective?.var ?? '') &&
                              !matchingOptionValue
                                ? [
                                    ...assertVariableOptions,
                                    {
                                      group: 'Current selection',
                                      items: [
                                        {
                                          value:
                                            encodeObjectiveVariableOptionValue(
                                              'current',
                                              assertObjective?.var ?? '',
                                            ),
                                          label: assertObjective?.var ?? '',
                                          disabled: false,
                                        },
                                      ],
                                    },
                                  ]
                                : assertVariableOptions

                            return (
                              <Select
                                size='xs'
                                searchable
                                data={availableVariableOptions}
                                placeholder={
                                  assertVariableOptions.length > 0
                                    ? 'Select output variable'
                                    : 'No task group outputs available'
                                }
                                nothingFoundMessage='No matching output variable'
                                value={
                                  matchingOptionValue ??
                                  ((assertObjective?.var ?? '')
                                    ? encodeObjectiveVariableOptionValue(
                                        'current',
                                        assertObjective?.var ?? '',
                                      )
                                    : null)
                                }
                                onChange={(value) =>
                                  onUpdateAssertObjective(objectiveId, {
                                    var: value
                                      ? decodeObjectiveVariableOptionValue(
                                          value,
                                        )
                                      : '',
                                  })
                                }
                                aria-label={`Objective ${index + 1} variable`}
                              />
                            )
                          })()}
                        </Input.Wrapper>
                        <Input.Wrapper
                          label='Target'
                          className={classes.objectiveFieldSmall}
                        >
                          <Select
                            size='xs'
                            data={[
                              { value: 'true', label: 'True' },
                              { value: 'false', label: 'False' },
                            ]}
                            value={
                              (assertObjective?.target ?? true)
                                ? 'true'
                                : 'false'
                            }
                            onChange={(value) =>
                              onUpdateAssertObjective(objectiveId, {
                                target: value !== 'false',
                              })
                            }
                            disabled={!(assertObjective?.var ?? '')}
                            aria-label={`Objective ${index + 1} target`}
                          />
                        </Input.Wrapper>
                      </Group>
                    ) : (
                      <Group mt='xs' gap='xs' align='flex-end' wrap='wrap'>
                        <Input.Wrapper
                          label='Variable'
                          className={classes.objectiveFieldMedium}
                        >
                          {(() => {
                            const matchingOptionValue = thresholdVariableOptions
                              .flatMap((option) => {
                                if (typeof option === 'string') {
                                  return [option]
                                }

                                if ('items' in option) {
                                  return option.items.flatMap((item) =>
                                    typeof item === 'string'
                                      ? [item]
                                      : [item.value],
                                  )
                                }

                                return [option.value]
                              })
                              .find(
                                (optionValue) =>
                                  decodeObjectiveVariableOptionValue(
                                    optionValue,
                                  ) === (thresholdObjective?.var ?? ''),
                              )

                            const availableVariableOptions: ComboboxData =
                              (thresholdObjective?.var ?? '') &&
                              !matchingOptionValue
                                ? [
                                    ...thresholdVariableOptions,
                                    {
                                      group: 'Current selection',
                                      items: [
                                        {
                                          value:
                                            encodeObjectiveVariableOptionValue(
                                              'current-threshold',
                                              thresholdObjective?.var ?? '',
                                            ),
                                          label: thresholdObjective?.var ?? '',
                                        },
                                      ],
                                    },
                                  ]
                                : thresholdVariableOptions

                            return (
                              <Select
                                size='xs'
                                searchable
                                data={availableVariableOptions}
                                placeholder={
                                  thresholdVariableOptions.length > 0
                                    ? 'Select numeric output variable'
                                    : 'No numeric task group outputs available'
                                }
                                nothingFoundMessage='No matching numeric output variable'
                                value={
                                  matchingOptionValue ??
                                  ((thresholdObjective?.var ?? '')
                                    ? encodeObjectiveVariableOptionValue(
                                        'current-threshold',
                                        thresholdObjective?.var ?? '',
                                      )
                                    : null)
                                }
                                onChange={(value) =>
                                  onUpdateThresholdObjective(objectiveId, {
                                    var: value
                                      ? decodeObjectiveVariableOptionValue(
                                          value,
                                        )
                                      : '',
                                  })
                                }
                                aria-label={`Objective ${index + 1} variable`}
                              />
                            )
                          })()}
                        </Input.Wrapper>

                        <Input.Wrapper
                          label='Target'
                          className={classes.objectiveFieldSmall}
                        >
                          <NumberInput
                            size='xs'
                            min={getThresholdTargetBounds(objectiveKind).min}
                            max={getThresholdTargetBounds(objectiveKind).max}
                            step={getThresholdTargetBounds(objectiveKind).step}
                            value={
                              thresholdObjective?.target ??
                              getThresholdTargetBounds(objectiveKind)
                                .defaultValue
                            }
                            onChange={(value) => {
                              const parsed =
                                typeof value === 'number'
                                  ? value
                                  : Number.parseFloat(String(value))

                              onUpdateThresholdObjective(objectiveId, {
                                target: normalizeThresholdTarget(
                                  objectiveKind,
                                  Number.isFinite(parsed)
                                    ? parsed
                                    : getThresholdTargetBounds(objectiveKind)
                                        .defaultValue,
                                ),
                              })
                            }}
                            aria-label={`Objective ${index + 1} target`}
                            disabled={!(thresholdObjective?.var ?? '')}
                          />
                        </Input.Wrapper>
                      </Group>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </Collapse>
    </Paper>
  )
}

type CapabilityServiceMenuProps = {
  service: Service
  portalTarget: HTMLDivElement | null
  onSelectEndpoint: (capability: Capability, endpoint: string) => void
  onSelectEvent: (capability: Capability, eventName: string) => void
}

function CapabilityServiceMenu({
  service,
  portalTarget,
  onSelectEndpoint,
  onSelectEvent,
}: CapabilityServiceMenuProps) {
  const [submenuOpened, setSubmenuOpened] = useState(false)
  const [capabilityPortalTarget, setCapabilityPortalTarget] =
    useState<HTMLDivElement | null>(null)
  const { data: capabilitiesData } = useSWR(
    `/api/v1/capabilities?service_id=${service.id}`,
    (url: string) => fetch(url).then((res) => (res.ok ? res.json() : [])),
  )
  const capabilities = [...((capabilitiesData ?? []) as Capability[])].sort(
    (a, b) => a.name.localeCompare(b.name),
  )

  return (
    <Menu
      opened={submenuOpened}
      onChange={setSubmenuOpened}
      withinPortal
      portalProps={{ target: portalTarget ?? undefined }}
      floatingStrategy='fixed'
      position='right-start'
      trigger='click'
    >
      <Menu.Target>
        <div
          className={classes.addNodeMenuItem}
          onClick={() => setSubmenuOpened((opened) => !opened)}
        >
          <Group justify='space-between' w='100%' wrap='nowrap'>
            <SlidingMenuLabel>
              {service.name.replaceAll('-', ' ').toUpperCase()}
            </SlidingMenuLabel>
            <Group gap={4} wrap='nowrap'>
              <Badge mx='sm' size='sm' variant='filled' color='gray'>
                {capabilities.length}
              </Badge>
              <IHubIconChevronRight size={14} />
            </Group>
          </Group>
        </div>
      </Menu.Target>
      <Menu.Dropdown className={classes.addNodeSubmenuDropdown}>
        <div className={classes.addNodeMenuScrollArea}>
          <Menu.Label>Capabilities</Menu.Label>
          {capabilities.map((capability, capabilityIndex) => (
            <Menu
              key={`model-capability-${service.id}-${capability.id}-${capabilityIndex}`}
              withinPortal
              portalProps={{
                target: capabilityPortalTarget ?? undefined,
              }}
              floatingStrategy='fixed'
              trigger='click'
              position='right-start'
            >
              <Menu.Target>
                <div className={classes.addNodeMenuItem}>
                  <Group justify='space-between' w='100%' wrap='nowrap'>
                    <SlidingMenuLabel>{capability.name}</SlidingMenuLabel>
                    <Group gap={4} wrap='nowrap'>
                      <Badge mx='sm' size='sm' variant='filled' color='gray'>
                        {Object.keys(capability.endpoints_schema.endpoints)
                          .length +
                          Object.keys(capability.endpoints_schema.events ?? {})
                            .length}
                      </Badge>
                      <IHubIconChevronRight size={14} />
                    </Group>
                  </Group>
                </div>
              </Menu.Target>
              <Menu.Dropdown className={classes.boundedMenuDropdown}>
                <Menu.Label>Endpoints</Menu.Label>
                {Object.keys(capability.endpoints_schema.endpoints)
                  .sort((left, right) => left.localeCompare(right))
                  .map((endpoint) => (
                    <Menu.Item
                      key={`model-endpoint-${capability.id}-${endpoint}`}
                      onClick={() => onSelectEndpoint(capability, endpoint)}
                    >
                      <SlidingMenuLabel>{endpoint}</SlidingMenuLabel>
                    </Menu.Item>
                  ))}
                {Object.keys(capability.endpoints_schema.events ?? {}).length >
                  0 && (
                  <>
                    <Menu.Divider />
                    <Menu.Label>Events</Menu.Label>
                    {Object.keys(capability.endpoints_schema.events ?? {})
                      .sort((left, right) => left.localeCompare(right))
                      .map((eventName) => (
                        <Menu.Item
                          key={`model-event-${capability.id}-${eventName}`}
                          onClick={() => onSelectEvent(capability, eventName)}
                        >
                          <SlidingMenuLabel>{eventName}</SlidingMenuLabel>
                        </Menu.Item>
                      ))}
                  </>
                )}
              </Menu.Dropdown>
            </Menu>
          ))}
        </div>
        <div ref={setCapabilityPortalTarget} />
      </Menu.Dropdown>
    </Menu>
  )
}
