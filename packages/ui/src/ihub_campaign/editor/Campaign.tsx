'use client'

import type { Broker, CampaignModel } from '@ihub/utils/types/campaign'
import { formatLocalDateTime } from '@ihub/utils/helpers/date-time'
import useSWR, { type Fetcher } from 'swr'

import * as classes from './styles.module.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Drawer,
  Group,
  Menu,
  Modal,
  Paper,
  rem,
  Stack,
  Text,
} from '@mantine/core'
import type { JupyterServerConfig } from '@ihub/utils/types/notebook'
import { ReactFlowProvider, type Node, type Viewport } from '@xyflow/react'
import { CampaignProvider } from '../state/campaignContext'
import {
  CampaignExecutionProvider,
  CampaignExecutionDisplayProvider,
  type NodeStatus,
  useCampaignExecution,
} from '../state/executionContext'
import { CurrentRunIdContext } from '../state/currentRunContext'
import { CampaignEventLogProvider } from '../state/eventLogContext'
import {
  CampaignViewContext,
  createCampaignViewMutationGuard,
  type CampaignViewScope,
} from '../state/campaignViewContext'
import { useCampaignExecutionController } from '../execution/useCampaignExecutionController'
import { canStopCampaign } from '../execution/stopControls'
import { getCampaignRunControlState } from '../execution/runControls'
import { CodeNodeConnectionRegistryProvider } from '../state/codeNodeConnectionRegistryContext'
import { CampaignStopDialog } from './CampaignStopDialog'
import { CampaignRecoveryUi } from './CampaignRecoveryUi'
import { CampaignBrokerSelector } from './CampaignBrokerSelector'
import { TopMenuBar } from '../../navigation/TopMenuBar'
import { TopMenuButton } from '../../navigation/TopMenuButton'
import { downloadJson } from '@ihub/utils/helpers/download'
import {
  IHubIconChevronDown,
  IHubIconCheck,
  IHubIconCircle,
  IHubIconCube,
  IHubIconDownload,
  IHubIconError,
  IHubIconInfoCircle,
  IHubIconLayout,
  IHubIconPlay,
  IHubIconStop,
  IHubIconX,
} from '@ihub/utils/icons'
import { getRecoveryRunDisabledReason } from '../execution/recovery'
import {
  fetchCampaignRunSnapshots,
  fetchHistoricalCampaignRecovery,
  selectHistoricalCampaignDocument,
  selectHistoricalCampaignRuns,
  useCampaignRuns,
} from '../execution/useCampaignRuns'
import type { CampaignRun } from '../execution/recovery'
import {
  extractHistoricalRunErrors,
  reconstructHistoricalNodeStatuses,
  type HistoricalRunError,
} from '../execution/historicalRun'
import { createCampaignDocumentSession } from '../document'
import { hasExecutableCampaignTasks } from '../model/selectors'
import {
  CampaignOnboarding,
  CampaignSheetTabs,
  CapabilityTaskMenu,
  TaskGroupObjectivesEditor,
} from './CampaignPresentation'
import { CampaignCanvas } from './CampaignCanvas'
import { useCampaignDocumentSession } from './useCampaignDocumentSession'
import {
  toPlainJsonValue,
  useCampaignModelPersistence,
} from './useCampaignModelPersistence'
import { masterCampaignSheetId } from './campaignEditorState'
import { useCampaignTaskGroupEditor } from './useCampaignTaskGroupEditor'
import { useCampaignGraphEditor } from './useCampaignGraphEditor'
import { useCampaignNodeTypes } from './useCampaignNodeTypes'
import { useCampaignDocumentActivity } from './useCampaignDocumentActivity'
import { CampaignNodeInspector } from './CampaignNodeInspector'
import { CampaignAllNodes } from './CampaignAllNodes'
import { CampaignSidePanel } from './CampaignSidePanel'
import {
  deriveCampaignAllNodesGroups,
  type CampaignAllNodesEntry,
} from './campaignNodeOverview'
import {
  DEFAULT_CAMPAIGN_INSPECTOR_WIDTH,
  clampCampaignInspectorWidth,
  getCampaignInspectorNodeIdAfterClick,
  getCampaignInspectorNodeIdAfterSelection,
  isCampaignInspectorNode,
  leaveCampaignInspector,
  openCampaignNodesList,
  reconcileCampaignPanelAfterSelectionClear,
  reconcileCampaignPanelAfterSheetChange,
  toggleCampaignAllNodesPanel,
  type CampaignSidePanelState,
} from './campaignInspectorState'
import {
  CapabilityInputDraftProvider,
  useCapabilityInputDraftCoordinator,
} from '../state/capabilityInputDraftContext'
import { CodeNodeEditorOwnershipProvider } from './CodeNodeEditorOwnershipContext'
import { CapabilityInputSourceOverrideProvider } from '../state/capabilityInputSourceOverrideContext'

const fetchBrokers: Fetcher<Broker[], string> = (url) =>
  fetch(url).then((response) =>
    response.ok ? response.json() : ([] as Broker[]),
  )
const emptyJupyterServers: JupyterServerConfig[] = []

function getCampaignRunOutcomePresentation(run: CampaignRun) {
  if (run.status === 'ACTIVE') {
    return { label: 'Running', color: 'blue', Icon: IHubIconCircle }
  }
  if (run.outcome === 'SUCCEEDED') {
    return { label: 'Succeeded', color: 'green', Icon: IHubIconCheck }
  }
  if (run.outcome === 'FAILED') {
    return { label: 'Failed', color: 'red', Icon: IHubIconError }
  }
  if (run.outcome === 'CANCELED') {
    return { label: 'Canceled', color: 'yellow', Icon: IHubIconX }
  }
  if (run.outcome === 'INTERRUPTED') {
    return { label: 'Interrupted', color: 'yellow', Icon: IHubIconInfoCircle }
  }
  if (run.status === 'ABORTED') {
    return {
      label: 'Aborted — outcome unavailable',
      color: 'gray',
      Icon: IHubIconInfoCircle,
    }
  }
  return { label: 'Outcome unavailable', color: 'gray', Icon: IHubIconCircle }
}

function CampaignRunOutcomeLabel({ run }: { run: CampaignRun }) {
  const { label, color, Icon } = getCampaignRunOutcomePresentation(run)
  return (
    <Group gap={5} wrap='nowrap' c={color}>
      <Icon size={14} aria-hidden />
      <Text size='xs' fw={600} style={{ whiteSpace: 'nowrap' }}>
        {label}
      </Text>
    </Group>
  )
}

interface CanonicalCampaignEditorProps {
  campaignData: CampaignModel
  setDocumentContent?: (
    campaignData: CampaignModel,
    options?: { dirty?: boolean },
  ) => void
  jupyterServers?: JupyterServerConfig[]
  projectId?: string
  downloadFileName?: string
  onDocumentActivityChange?: (active: boolean) => void
  selectedSheetId?: string
  onSelectedSheetIdChange?: (sheetId: string) => void
  sheetViewports?: Readonly<Record<string, Viewport>>
  onSheetViewportChange?: (sheetId: string, viewport: Viewport) => void
}

interface CampaignProps {
  campaignData: CampaignModel
  setDocumentContent?: (
    campaignData: CampaignModel,
    options?: { dirty?: boolean },
  ) => void
  jupyterServers?: JupyterServerConfig[]
  projectId?: string
  downloadFileName?: string
  onDocumentActivityChange?: (active: boolean) => void
  selectedSheetId?: string
  onSelectedSheetIdChange?: (sheetId: string) => void
  sheetViewports?: Readonly<Record<string, Viewport>>
  onSheetViewportChange?: (sheetId: string, viewport: Viewport) => void
}

/**
 * Wraps the campaign editor in its context provider.
 *
 * @param props - Campaign editor input data and optional integration hooks.
 * @returns The context-enabled campaign editor UI.
 */
export default function Campaign(props: CampaignProps) {
  return (
    <CampaignExecutionProvider>
      <CodeNodeConnectionRegistryProvider>
        <CampaignProvider>
          <CapabilityInputSourceOverrideProvider>
            <CampaignDocumentBoundary {...props} />
          </CapabilityInputSourceOverrideProvider>
        </CampaignProvider>
      </CodeNodeConnectionRegistryProvider>
    </CampaignExecutionProvider>
  )
}

function CampaignDocumentBoundary(props: CampaignProps) {
  const sessionResult = useCampaignDocumentSession(props.campaignData)

  if ('error' in sessionResult) {
    const message =
      sessionResult.error instanceof Error
        ? sessionResult.error.message
        : 'The campaign document format is not supported.'

    return (
      <Alert color='red' title='Campaign could not be opened'>
        {message}
      </Alert>
    )
  }

  return (
    <CampaignModelComponent
      campaignData={sessionResult.session.model}
      setDocumentContent={props.setDocumentContent}
      jupyterServers={props.jupyterServers}
      projectId={props.projectId}
      downloadFileName={props.downloadFileName}
      onDocumentActivityChange={props.onDocumentActivityChange}
      selectedSheetId={props.selectedSheetId}
      onSelectedSheetIdChange={props.onSelectedSheetIdChange}
      sheetViewports={props.sheetViewports}
      onSheetViewportChange={props.onSheetViewportChange}
    />
  )
}

function CampaignModelComponent({
  campaignData,
  setDocumentContent,
  jupyterServers = emptyJupyterServers,
  projectId,
  downloadFileName,
  onDocumentActivityChange,
  selectedSheetId: restoredSelectedSheetId,
  onSelectedSheetIdChange,
  sheetViewports,
  onSheetViewportChange,
}: CanonicalCampaignEditorProps) {
  const { state: executionState } = useCampaignExecution()
  const [historicalRun, setHistoricalRun] = useState<CampaignRun | null>(null)
  const [historicalCampaignModel, setHistoricalCampaignModel] =
    useState<CampaignModel | null>(null)
  const [historicalReplayCampaignModel, setHistoricalReplayCampaignModel] =
    useState<CampaignModel | null>(null)
  const [historicalNodeStatuses, setHistoricalNodeStatuses] = useState<
    Record<string, NodeStatus>
  >({})
  const [historicalNodeRunCounts, setHistoricalNodeRunCounts] = useState<
    Record<string, number>
  >({})
  const [historicalErrors, setHistoricalErrors] = useState<
    HistoricalRunError[]
  >([])
  const [historicalRecoveryError, setHistoricalRecoveryError] = useState<
    string | null
  >(null)
  const [isHistoricalRecoveryLoading, setIsHistoricalRecoveryLoading] =
    useState(false)
  const [isRunErrorsDrawerOpen, setRunErrorsDrawerOpen] = useState(false)
  const [isLegacyHistoricalRun, setIsLegacyHistoricalRun] = useState(false)
  const [isHistoricalViewLoading, setIsHistoricalViewLoading] = useState(false)
  const [isRestoreHistoricalModalOpen, setRestoreHistoricalModalOpen] =
    useState(false)
  const [historicalViewError, setHistoricalViewError] = useState<string | null>(
    null,
  )
  const historicalRequestRef = useRef<AbortController | null>(null)
  const isHistoricalView = historicalRun !== null
  const campaignViewProvenanceKey = historicalRun
    ? `run:${historicalRun.run_id}`
    : `campaign:${campaignData.id}`
  const latestCampaignViewScopeRef = useRef<CampaignViewScope>({
    provenanceKey: campaignViewProvenanceKey,
    readOnly: isHistoricalView,
  })
  latestCampaignViewScopeRef.current = {
    provenanceKey: campaignViewProvenanceKey,
    readOnly: isHistoricalView,
  }
  const canMutateCampaignView = useMemo(
    () =>
      createCampaignViewMutationGuard(() => latestCampaignViewScopeRef.current),
    [],
  )
  const campaignViewSettings = useMemo(
    () => ({
      provenanceKey: campaignViewProvenanceKey,
      readOnly: isHistoricalView,
      canMutate: canMutateCampaignView,
    }),
    [campaignViewProvenanceKey, canMutateCampaignView, isHistoricalView],
  )
  const {
    campaignModel,
    setWorkingCampaignModel,
    persistCampaignModel,
    latestCampaignModelRef,
    latestPersistCampaignModelRef,
    intersectId,
    setIntersectId,
    alignBrokerForRecovery,
  } = useCampaignModelPersistence({
    campaignData,
    historicalCampaignModel,
    isHistoricalView,
    setDocumentContent,
  })
  const { data: brokers } = useSWR('/api/v1/brokers', fetchBrokers)
  const { data: priorRuns, mutate: refreshPriorRuns } = useCampaignRuns(
    campaignData.id,
  )
  const historicalRuns = useMemo(
    () => selectHistoricalCampaignRuns(priorRuns),
    [priorRuns],
  )
  const selectedBroker = brokers?.find(({ id }) => String(id) === intersectId)
  const selectedBrokerStatus = selectedBroker?.status
  const {
    selectedSheetId,
    setSelectedSheetId,
    selectedTaskGroupId,
    latestSelectedTaskGroupIdRef,
    selectedTaskGroup,
    selectedTaskGroupAssertVariableOptions,
    selectedTaskGroupNumericVariableOptions,
    selectedTaskGroupThemeColor,
    selectedTaskGroupUnifiedObjectives,
    tabs,
    handleAddTaskGroup,
    handleAddCapabilityTask,
    handleAddEventTask,
    handleAddVisualizationTask,
    handleAddRendererTask,
    handleAddJsonFileTask,
    handleAddJsonTextTask,
    handleAddTaskGroupObjective,
    handleChangeUnifiedObjectiveKind,
    handleUpdateAssertObjective,
    handleUpdateIterateObjective,
    handleUpdateThresholdObjective,
    handleRemoveUnifiedObjective,
  } = useCampaignTaskGroupEditor({
    campaignModel,
    persistCampaignModel,
    latestCampaignModelRef,
    selectedSheetId: restoredSelectedSheetId,
    onSelectedSheetIdChange,
  })
  const {
    contextValue: capabilityInputDraftContextValue,
    flushCapabilityInputDrafts,
  } = useCapabilityInputDraftCoordinator({
    latestCampaignModelRef,
    persistCampaignModel,
    provenanceKey: campaignViewProvenanceKey,
    readOnly: isHistoricalView,
    taskGroupId: selectedTaskGroupId,
  })
  const [isStopModalOpen, setStopModalOpen] = useState(false)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [sidePanelState, setSidePanelState] = useState<CampaignSidePanelState>({
    mode: 'closed',
  })
  const [inspectorWidth, setInspectorWidth] = useState(
    DEFAULT_CAMPAIGN_INSPECTOR_WIDTH,
  )
  const [workspaceWidth, setWorkspaceWidth] = useState(0)
  const workspaceRef = useRef<HTMLDivElement>(null)
  const inspectorHeadingRef = useRef<HTMLHeadingElement>(null)
  const allNodesHeadingRef = useRef<HTMLHeadingElement>(null)
  const allNodesRowRefs = useRef(new Map<string, HTMLButtonElement>())
  const selectionHistoryRef = useRef<string[]>([])
  const selectedFlowNodeIdsRef = useRef<Set<string>>(new Set())
  const pointerSelectionRef = useRef(false)
  const pointerDownInspectorNodeIdRef = useRef<string | null | undefined>(
    undefined,
  )
  const selectedNodeIdRef = useRef<string | null>(null)
  selectedNodeIdRef.current = selectedNodeId
  const sidePanelStateRef = useRef<CampaignSidePanelState>(sidePanelState)
  sidePanelStateRef.current = sidePanelState
  const {
    flowNodes,
    flowEdges,
    isGraphReady,
    handleModelLayout,
    onNodeDragStop: persistNodeDragStop,
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
  } = useCampaignGraphEditor({
    campaignModel,
    campaignIdentity: campaignData.id,
    viewIdentity: campaignViewProvenanceKey,
    selectedSheetId,
    persistCampaignModel,
    latestCampaignModelRef,
    latestPersistCampaignModelRef,
    latestSelectedTaskGroupIdRef,
    setSelectedSheetId,
    flushCapabilityInputDrafts,
  })
  const handleNodeDragStop = useCallback(
    (...args: Parameters<typeof persistNodeDragStop>) => {
      persistNodeDragStop(...args)
      pointerSelectionRef.current = false
      pointerDownInspectorNodeIdRef.current = undefined
    },
    [persistNodeDragStop],
  )
  const selectedNode = useMemo(
    () =>
      flowNodes.find(
        (node) => node.id === selectedNodeId && isCampaignInspectorNode(node),
      ) ?? null,
    [flowNodes, selectedNodeId],
  )
  const allNodesGroups = useMemo(
    () => deriveCampaignAllNodesGroups(campaignModel),
    [campaignModel],
  )
  const inspectedCodeNodeId =
    selectedNode?.type === 'code' ? selectedNode.id : null
  const {
    execute,
    stop,
    isExecutingCampaign,
    isStartingCampaign,
    isStoppingCampaign,
    activeCampaignRunId,
    currentRunId,
    latestLogRunId,
    isLatestLogRunLoading,
    latestLogRunError,
    retryLatestLogRun,
    eventLogRefreshSignals,
    executionError,
    dismissExecutionError,
    activeCampaignBrokerId,
    recoveryState,
    selectRun,
    selectRecoveryRun,
    retryRecovery,
    isBrokerSelectionLocked,
  } = useCampaignExecutionController({
    executionPayload: campaignModel,
    nodes: flowNodes,
    intersectId,
    selectedBrokerStatus,
    jupyterServers,
    campaignIdentity: campaignData.id,
    isGraphReady,
    alignBrokerForRecovery,
  })

  const handleRunCampaign = useCallback(
    () => execute(flushCapabilityInputDrafts()),
    [execute, flushCapabilityInputDrafts],
  )
  const handleDownloadCampaign = useCallback(() => {
    const nextCampaignModel = flushCapabilityInputDrafts()
    downloadJson(downloadFileName ?? nextCampaignModel.name, nextCampaignModel)
  }, [downloadFileName, flushCapabilityInputDrafts])
  const handleSelectSheet = useCallback(
    (sheetId: string) => {
      flushCapabilityInputDrafts()
      setSelectedSheetId(sheetId)
    },
    [flushCapabilityInputDrafts, setSelectedSheetId],
  )
  const handleCreateTaskGroup = useCallback(() => {
    flushCapabilityInputDrafts()
    handleAddTaskGroup()
  }, [flushCapabilityInputDrafts, handleAddTaskGroup])
  const handleCreateCapabilityTask = useCallback(
    (...args: Parameters<typeof handleAddCapabilityTask>) => {
      flushCapabilityInputDrafts()
      handleAddCapabilityTask(...args)
    },
    [flushCapabilityInputDrafts, handleAddCapabilityTask],
  )
  const handleCreateEventTask = useCallback(
    (...args: Parameters<typeof handleAddEventTask>) => {
      flushCapabilityInputDrafts()
      handleAddEventTask(...args)
    },
    [flushCapabilityInputDrafts, handleAddEventTask],
  )
  const handleCreateVisualizationTask = useCallback(
    (...args: Parameters<typeof handleAddVisualizationTask>) => {
      flushCapabilityInputDrafts()
      handleAddVisualizationTask(...args)
    },
    [flushCapabilityInputDrafts, handleAddVisualizationTask],
  )
  const handleCreateRendererTask = useCallback(
    (...args: Parameters<typeof handleAddRendererTask>) => {
      flushCapabilityInputDrafts()
      handleAddRendererTask(...args)
    },
    [flushCapabilityInputDrafts, handleAddRendererTask],
  )
  const handleCreateJsonFileTask = useCallback(() => {
    flushCapabilityInputDrafts()
    handleAddJsonFileTask()
  }, [flushCapabilityInputDrafts, handleAddJsonFileTask])
  const handleCreateJsonTextTask = useCallback(() => {
    flushCapabilityInputDrafts()
    handleAddJsonTextTask()
  }, [flushCapabilityInputDrafts, handleAddJsonTextTask])
  const handleRemoveTaskGroup = useCallback(
    (taskGroupId: string) => {
      flushCapabilityInputDrafts()
      handleDeleteTaskGroup(taskGroupId)
    },
    [flushCapabilityInputDrafts, handleDeleteTaskGroup],
  )
  const handleRemoveTask = useCallback(
    (taskId: string) => {
      flushCapabilityInputDrafts()
      if (
        sidePanelStateRef.current.mode === 'inspector' &&
        sidePanelStateRef.current.nodeId === taskId
      ) {
        setSidePanelState(leaveCampaignInspector(sidePanelStateRef.current))
        selectedNodeIdRef.current = null
        setSelectedNodeId(null)
      }
      handleDeleteTask(taskId)
    },
    [flushCapabilityInputDrafts, handleDeleteTask],
  )

  const commitActiveNodeEditor = useCallback(() => {
    const activeElement = document.activeElement
    if (activeElement instanceof HTMLElement) activeElement.blur()
    flushCapabilityInputDrafts()
  }, [flushCapabilityInputDrafts])

  const changeSelectedNode = useCallback(
    (
      nextNodeId: string | null,
      focusInspector: boolean,
      source: 'canvas' | 'overview' = 'canvas',
    ) => {
      if (
        selectedNodeIdRef.current === nextNodeId &&
        (nextNodeId !== null || sidePanelStateRef.current.mode !== 'inspector')
      ) {
        return
      }
      commitActiveNodeEditor()
      selectedNodeIdRef.current = nextNodeId
      setSelectedNodeId(nextNodeId)
      if (nextNodeId === null) {
        const nextPanel = reconcileCampaignPanelAfterSelectionClear(
          sidePanelStateRef.current,
        )
        sidePanelStateRef.current = nextPanel
        setSidePanelState(nextPanel)
        return
      }
      if (focusInspector) {
        window.requestAnimationFrame(() => inspectorHeadingRef.current?.focus())
      }
      const currentPanel = sidePanelStateRef.current
      const nextPanel: CampaignSidePanelState =
        currentPanel.mode === 'inspector' && currentPanel.nodeId === nextNodeId
          ? currentPanel
          : {
              mode: 'inspector',
              nodeId: nextNodeId,
              taskGroupId: selectedSheetId,
              source,
            }
      sidePanelStateRef.current = nextPanel
      setSidePanelState(nextPanel)
    },
    [commitActiveNodeEditor, selectedSheetId],
  )

  const handleSelectionChange = useCallback(
    ({ nodes }: { nodes: Node[] }) => {
      const isInspectorNodePointerGesture =
        pointerDownInspectorNodeIdRef.current !== undefined
      const selectedSupportedNodeIds = nodes
        .filter(isCampaignInspectorNode)
        .map(({ id }) => id)
      const newlySelectedNodeIds = selectedSupportedNodeIds.filter(
        (nodeId) => !selectedFlowNodeIdsRef.current.has(nodeId),
      )
      if (!isInspectorNodePointerGesture && newlySelectedNodeIds.length > 0) {
        const newlySelectedNodeIdSet = new Set(newlySelectedNodeIds)
        selectionHistoryRef.current = [
          ...selectionHistoryRef.current.filter(
            (nodeId) => !newlySelectedNodeIdSet.has(nodeId),
          ),
          ...newlySelectedNodeIds,
        ]
      }
      selectedFlowNodeIdsRef.current = new Set(selectedSupportedNodeIds)
      const nextNodeId = getCampaignInspectorNodeIdAfterSelection(
        selectedNodeIdRef.current,
        nodes,
        selectionHistoryRef.current,
        isInspectorNodePointerGesture,
      )
      const focusInspector =
        !isInspectorNodePointerGesture &&
        nextNodeId !== null &&
        !pointerSelectionRef.current
      changeSelectedNode(nextNodeId, focusInspector)
      pointerSelectionRef.current = false
    },
    [changeSelectedNode],
  )

  const handleCloseInspector = useCallback(() => {
    const closingNodeId = selectedNodeIdRef.current
    changeSelectedNode(null, false)
    sidePanelStateRef.current = { mode: 'closed' }
    setSidePanelState({ mode: 'closed' })
    if (closingNodeId) {
      onModelNodesChange([
        { type: 'select', id: closingNodeId, selected: false },
      ])
    }
    window.requestAnimationFrame(() => {
      const escapedNodeId = closingNodeId
        ? CSS.escape(closingNodeId)
        : undefined
      const nodeElement = escapedNodeId
        ? document.querySelector<HTMLElement>(
            `.react-flow__node[data-id='${escapedNodeId}']`,
          )
        : null
      const controlsElement = document.querySelector<HTMLElement>(
        '.react-flow__controls button',
      )
      ;(nodeElement ?? controlsElement)?.focus()
    })
  }, [changeSelectedNode, onModelNodesChange])

  const deselectCurrentNode = useCallback(() => {
    const currentNodeId = selectedNodeIdRef.current
    if (!currentNodeId) return
    selectedNodeIdRef.current = null
    setSelectedNodeId(null)
    onModelNodesChange([{ type: 'select', id: currentNodeId, selected: false }])
  }, [onModelNodesChange])

  const handleToggleAllNodes = useCallback(() => {
    commitActiveNodeEditor()
    deselectCurrentNode()
    const nextPanel = toggleCampaignAllNodesPanel(sidePanelStateRef.current)
    sidePanelStateRef.current = nextPanel
    setSidePanelState(nextPanel)
    if (nextPanel.mode === 'overview') {
      window.requestAnimationFrame(() => allNodesHeadingRef.current?.focus())
    }
  }, [commitActiveNodeEditor, deselectCurrentNode])

  const handleCloseAllNodes = useCallback(() => {
    commitActiveNodeEditor()
    sidePanelStateRef.current = { mode: 'closed' }
    setSidePanelState({ mode: 'closed' })
  }, [commitActiveNodeEditor])

  const handleSelectAllNodesEntry = useCallback(
    (entry: CampaignAllNodesEntry) => {
      commitActiveNodeEditor()
      deselectCurrentNode()
      const nextPanel: CampaignSidePanelState = {
        mode: 'inspector',
        nodeId: entry.nodeId,
        taskGroupId: entry.taskGroupId,
        source: 'overview',
      }
      sidePanelStateRef.current = nextPanel
      setSidePanelState(nextPanel)
      if (selectedSheetId !== entry.taskGroupId) {
        setSelectedSheetId(entry.taskGroupId)
      }
    },
    [
      commitActiveNodeEditor,
      deselectCurrentNode,
      selectedSheetId,
      setSelectedSheetId,
    ],
  )

  const handleOpenNodesList = useCallback(() => {
    commitActiveNodeEditor()
    const currentPanel = sidePanelStateRef.current
    deselectCurrentNode()
    const nextPanel = openCampaignNodesList(currentPanel)
    sidePanelStateRef.current = nextPanel
    setSidePanelState(nextPanel)
  }, [commitActiveNodeEditor, deselectCurrentNode])

  const registerAllNodesRow = useCallback(
    (nodeId: string) => (element: HTMLButtonElement | null) => {
      if (element) allNodesRowRefs.current.set(nodeId, element)
      else allNodesRowRefs.current.delete(nodeId)
    },
    [],
  )

  const handleNodeClick = useCallback(
    (event: React.MouseEvent, node: Node) => {
      if (!isCampaignInspectorNode(node)) return
      const inspectedNodeIdAtClickStart =
        event.detail > 0 && pointerDownInspectorNodeIdRef.current !== undefined
          ? pointerDownInspectorNodeIdRef.current
          : selectedNodeIdRef.current
      const nextNodeId = getCampaignInspectorNodeIdAfterClick(
        inspectedNodeIdAtClickStart,
        node.id,
      )
      if (nextNodeId === null) {
        handleCloseInspector()
      } else {
        selectionHistoryRef.current = [
          ...selectionHistoryRef.current.filter(
            (nodeId) => nodeId !== nextNodeId,
          ),
          nextNodeId,
        ]
        changeSelectedNode(nextNodeId, false)
      }
      window.queueMicrotask(() => {
        pointerSelectionRef.current = false
        pointerDownInspectorNodeIdRef.current = undefined
      })
    },
    [changeSelectedNode, handleCloseInspector],
  )

  const handleCanvasPointerDown = useCallback(
    (event: React.PointerEvent) => {
      pointerSelectionRef.current = true
      const target = event.target
      const pointerNodeId =
        target instanceof Element
          ? target.closest<HTMLElement>('.react-flow__node[data-id]')?.dataset
              .id
          : undefined
      const pointerNode = pointerNodeId
        ? flowNodes.find(({ id }) => id === pointerNodeId)
        : undefined
      pointerDownInspectorNodeIdRef.current =
        pointerNode && isCampaignInspectorNode(pointerNode)
          ? selectedNodeIdRef.current
          : undefined
    },
    [flowNodes],
  )

  useEffect(() => {
    const workspace = workspaceRef.current
    if (!workspace) return
    const resizeObserver = new ResizeObserver(([entry]) => {
      if (!entry) return
      const nextWorkspaceWidth = entry.contentRect.width
      setWorkspaceWidth(nextWorkspaceWidth)
      setInspectorWidth((currentWidth) =>
        clampCampaignInspectorWidth(currentWidth, nextWorkspaceWidth),
      )
    })
    resizeObserver.observe(workspace)
    return () => resizeObserver.disconnect()
  }, [])

  useEffect(() => {
    if (sidePanelState.mode !== 'inspector') return
    if (sidePanelState.source !== 'overview') return
    if (sidePanelState.taskGroupId !== selectedSheetId) return
    const targetNode = flowNodes.find(
      (node) =>
        node.id === sidePanelState.nodeId && isCampaignInspectorNode(node),
    )
    if (!targetNode || selectedNodeIdRef.current === targetNode.id) return
    onModelNodesChange([{ type: 'select', id: targetNode.id, selected: true }])
    changeSelectedNode(targetNode.id, true, 'overview')
  }, [
    changeSelectedNode,
    flowNodes,
    onModelNodesChange,
    selectedSheetId,
    sidePanelState,
  ])

  useEffect(() => {
    if (
      sidePanelState.mode === 'overview' &&
      sidePanelState.restoreFocusNodeId
    ) {
      window.requestAnimationFrame(() =>
        allNodesRowRefs.current
          .get(sidePanelState.restoreFocusNodeId!)
          ?.focus(),
      )
    }
  }, [sidePanelState])

  const previousSelectedSheetIdRef = useRef(selectedSheetId)
  useEffect(() => {
    if (previousSelectedSheetIdRef.current === selectedSheetId) return
    previousSelectedSheetIdRef.current = selectedSheetId
    const currentPanel = sidePanelStateRef.current
    selectionHistoryRef.current = []
    selectedFlowNodeIdsRef.current = new Set()
    selectedNodeIdRef.current = null
    setSelectedNodeId(null)
    if (
      currentPanel.mode === 'inspector' &&
      currentPanel.source === 'overview' &&
      currentPanel.taskGroupId === selectedSheetId
    ) {
      return
    }
    const nextPanel = reconcileCampaignPanelAfterSheetChange(currentPanel)
    sidePanelStateRef.current = nextPanel
    setSidePanelState(nextPanel)
  }, [selectedSheetId])

  const previousCampaignViewProvenanceRef = useRef(campaignViewProvenanceKey)
  useEffect(() => {
    if (
      previousCampaignViewProvenanceRef.current === campaignViewProvenanceKey
    ) {
      return
    }
    previousCampaignViewProvenanceRef.current = campaignViewProvenanceKey
    selectionHistoryRef.current = []
    selectedFlowNodeIdsRef.current = new Set()
    deselectCurrentNode()
    const currentPanel = sidePanelStateRef.current
    const nextPanel: CampaignSidePanelState =
      currentPanel.mode === 'overview' ||
      (currentPanel.mode === 'inspector' && currentPanel.source === 'overview')
        ? { mode: 'overview' }
        : { mode: 'closed' }
    sidePanelStateRef.current = nextPanel
    setSidePanelState(nextPanel)
  }, [campaignViewProvenanceKey, deselectCurrentNode])

  useEffect(() => {
    if (!selectedNodeId || selectedNode) return
    const currentPanel = sidePanelStateRef.current
    const nextPanel = leaveCampaignInspector(currentPanel)
    selectedNodeIdRef.current = null
    setSelectedNodeId(null)
    sidePanelStateRef.current = nextPanel
    setSidePanelState(nextPanel)
  }, [selectedNode, selectedNodeId])

  const handleSelectHistoricalRun = useCallback(
    async (run: CampaignRun) => {
      flushCapabilityInputDrafts()
      historicalRequestRef.current?.abort()
      const controller = new AbortController()
      historicalRequestRef.current = controller
      setHistoricalRun(run)
      setHistoricalCampaignModel(null)
      setHistoricalReplayCampaignModel(null)
      setHistoricalNodeStatuses({})
      setHistoricalNodeRunCounts({})
      setHistoricalErrors([])
      setHistoricalRecoveryError(null)
      setIsHistoricalRecoveryLoading(true)
      setRunErrorsDrawerOpen(false)
      setIsLegacyHistoricalRun(false)
      setIsHistoricalViewLoading(true)
      setHistoricalViewError(null)
      selectRun(run.run_id)

      try {
        const recoveryResultPromise = fetchHistoricalCampaignRecovery(
          run.run_id,
          controller.signal,
        ).then(
          (value) => ({ status: 'fulfilled' as const, value }),
          (reason: unknown) => ({ status: 'rejected' as const, reason }),
        )
        const snapshots = await fetchCampaignRunSnapshots(
          run.run_id,
          controller.signal,
        )
        if (controller.signal.aborted) return
        const historicalDocument = selectHistoricalCampaignDocument(snapshots)
        const snapshotSession = createCampaignDocumentSession(
          historicalDocument.document,
        )
        const replaySnapshotSession = createCampaignDocumentSession(
          historicalDocument.replayDocument,
        )
        setIsLegacyHistoricalRun(historicalDocument.legacyOrigin)
        setHistoricalCampaignModel(snapshotSession.model)
        setHistoricalReplayCampaignModel(replaySnapshotSession.model)
        setIsHistoricalViewLoading(false)

        const recoveryResult = await recoveryResultPromise
        if (controller.signal.aborted) return
        if (recoveryResult.status === 'fulfilled') {
          const reconstructed = reconstructHistoricalNodeStatuses(
            replaySnapshotSession.model,
            recoveryResult.value,
          )
          setHistoricalRun(recoveryResult.value.run)
          setHistoricalNodeStatuses(reconstructed.nodeStatuses)
          setHistoricalNodeRunCounts(reconstructed.nodeRunCounts)
          setHistoricalErrors(
            extractHistoricalRunErrors(
              snapshotSession.model,
              recoveryResult.value,
              reconstructed.stepToNodeMap,
            ),
          )
        } else {
          setHistoricalRecoveryError(
            recoveryResult.reason instanceof Error
              ? recoveryResult.reason.message
              : 'Execution history unavailable.',
          )
        }
      } catch (error) {
        if (controller.signal.aborted) return
        setHistoricalViewError(
          error instanceof Error
            ? error.message
            : 'Campaign provenance could not be loaded.',
        )
      } finally {
        if (!controller.signal.aborted) {
          setIsHistoricalViewLoading(false)
          setIsHistoricalRecoveryLoading(false)
        }
      }
    },
    [flushCapabilityInputDrafts, selectRun],
  )

  const retryHistoricalRecovery = useCallback(async () => {
    if (
      !historicalRun ||
      !historicalCampaignModel ||
      !historicalReplayCampaignModel
    ) {
      return
    }
    historicalRequestRef.current?.abort()
    const controller = new AbortController()
    historicalRequestRef.current = controller
    setIsHistoricalRecoveryLoading(true)
    setHistoricalRecoveryError(null)
    try {
      const recovery = await fetchHistoricalCampaignRecovery(
        historicalRun.run_id,
        controller.signal,
      )
      if (controller.signal.aborted) return
      const reconstructed = reconstructHistoricalNodeStatuses(
        historicalReplayCampaignModel,
        recovery,
      )
      setHistoricalRun(recovery.run)
      setHistoricalNodeStatuses(reconstructed.nodeStatuses)
      setHistoricalNodeRunCounts(reconstructed.nodeRunCounts)
      setHistoricalErrors(
        extractHistoricalRunErrors(
          historicalCampaignModel,
          recovery,
          reconstructed.stepToNodeMap,
        ),
      )
    } catch (error) {
      if (controller.signal.aborted) return
      setHistoricalRecoveryError(
        error instanceof Error
          ? error.message
          : 'Execution history unavailable.',
      )
    } finally {
      if (!controller.signal.aborted) setIsHistoricalRecoveryLoading(false)
    }
  }, [historicalCampaignModel, historicalReplayCampaignModel, historicalRun])

  const closeHistoricalView = useCallback(() => {
    historicalRequestRef.current?.abort()
    setRestoreHistoricalModalOpen(false)
    setHistoricalRun(null)
    setHistoricalCampaignModel(null)
    setHistoricalReplayCampaignModel(null)
    setHistoricalNodeStatuses({})
    setHistoricalNodeRunCounts({})
    setHistoricalErrors([])
    setHistoricalRecoveryError(null)
    setIsHistoricalRecoveryLoading(false)
    setRunErrorsDrawerOpen(false)
    setIsLegacyHistoricalRun(false)
    setIsHistoricalViewLoading(false)
    setHistoricalViewError(null)
    selectRun(null)
  }, [selectRun])

  const restoreHistoricalCampaign = useCallback(() => {
    if (!historicalCampaignModel) return

    const restoredCampaignModel = toPlainJsonValue(historicalCampaignModel)
    setWorkingCampaignModel(restoredCampaignModel)
    setDocumentContent?.(restoredCampaignModel, { dirty: true })
    closeHistoricalView()
  }, [
    closeHistoricalView,
    historicalCampaignModel,
    setDocumentContent,
    setWorkingCampaignModel,
  ])

  useEffect(
    () => () => {
      historicalRequestRef.current?.abort()
    },
    [],
  )
  useCampaignDocumentActivity(
    onDocumentActivityChange,
    isStartingCampaign,
    isExecutingCampaign,
    isStoppingCampaign,
  )

  const hasExecutableCapability = useMemo(
    () => hasExecutableCampaignTasks(campaignModel),
    [campaignModel],
  )
  const runControlState = getCampaignRunControlState({
    isStartingCampaign,
    isExecutingCampaign,
    intersectId,
    selectedBrokerStatus,
    hasExecutableCapability,
    recoveryDisabledReason: getRecoveryRunDisabledReason(recoveryState),
  })
  const isStopCampaignEnabled = canStopCampaign({
    intersectId: activeCampaignBrokerId,
    isExecutingCampaign,
    isStoppingCampaign,
    activeCampaignRunId,
  })
  const hasMinimumModelNodes = flowNodes.length >= 2

  useEffect(() => {
    if (!isExecutingCampaign) {
      setStopModalOpen(false)
    }
  }, [isExecutingCampaign])

  const nodeTypes = useCampaignNodeTypes({
    projectId,
    jupyterServers,
    onOpenTaskGroup: handleSelectSheet,
    onDeleteTaskGroup: handleRemoveTaskGroup,
    onDeleteTask: handleRemoveTask,
  })

  return (
    <div className={classes.campaignContainer}>
      <CampaignStopDialog
        opened={isStopModalOpen}
        isStoppingCampaign={isStoppingCampaign}
        stop={stop}
        close={() => setStopModalOpen(false)}
      />

      <Modal
        opened={isRestoreHistoricalModalOpen}
        onClose={() => setRestoreHistoricalModalOpen(false)}
        title='Replace current campaign?'
        centered
      >
        <Text size='sm'>
          This replaces the current campaign with the version captured for run{' '}
          {historicalRun?.run_id.slice(0, 8)}.
        </Text>
        <Group justify='flex-end' mt='md'>
          <Button
            variant='default'
            onClick={() => setRestoreHistoricalModalOpen(false)}
          >
            Cancel
          </Button>
          <Button onClick={restoreHistoricalCampaign}>
            Replace current campaign
          </Button>
        </Group>
      </Modal>

      <Drawer
        opened={isRunErrorsDrawerOpen}
        onClose={() => setRunErrorsDrawerOpen(false)}
        position='right'
        title='Run errors'
      >
        {historicalErrors.length === 0 ? (
          <Text size='sm' c='dimmed'>
            No error events were recorded for this run.
          </Text>
        ) : (
          <Stack gap='sm'>
            {historicalErrors.map((error) => (
              <Paper key={error.eventId} withBorder p='sm' radius='md'>
                <Stack gap='xs'>
                  <Group justify='space-between' align='flex-start'>
                    <Text size='sm' fw={600}>
                      {error.scope === 'task'
                        ? error.taskLabel || 'Task'
                        : 'Campaign'}
                    </Text>
                    <Text size='xs' c='dimmed'>
                      {formatLocalDateTime(error.timestamp, {
                        dateStyle: 'short',
                        timeStyle: 'medium',
                      }) ?? 'Unknown time'}
                    </Text>
                  </Group>
                  <Text size='sm'>{error.message}</Text>
                  <details>
                    <summary>Event details</summary>
                    <Stack gap={2} mt='xs'>
                      <Text size='xs'>Event type: {error.eventType}</Text>
                      <Text size='xs'>Event ID: {error.eventId}</Text>
                      <Text size='xs'>Run ID: {error.runId}</Text>
                      <Text size='xs'>Step ID: {error.stepId ?? 'None'}</Text>
                    </Stack>
                  </details>
                </Stack>
              </Paper>
            ))}
          </Stack>
        )}
      </Drawer>

      <TopMenuBar
        leftItems={
          <>
            {!isHistoricalView && (
              <CapabilityTaskMenu
                intersectId={intersectId}
                selectedTaskGroupId={selectedTaskGroupId}
                projectId={projectId}
                jupyterServers={jupyterServers}
                addCapabilityTask={handleCreateCapabilityTask}
                addEventTask={handleCreateEventTask}
                addJsonFileTask={handleCreateJsonFileTask}
                addJsonTextTask={handleCreateJsonTextTask}
                addVisualizationTask={handleCreateVisualizationTask}
                addRendererTask={handleCreateRendererTask}
              />
            )}
            <TopMenuButton
              Icon={IHubIconCube}
              hoverInfo='Nodes List'
              ariaLabel='Nodes List'
              pressed={sidePanelState.mode !== 'closed'}
              onClick={handleToggleAllNodes}
            />
            <TopMenuButton
              Icon={IHubIconLayout}
              hoverInfo='Auto-layout'
              onClick={handleModelLayout}
              disabled={isHistoricalView || !hasMinimumModelNodes}
            />

            <Group
              gap={0}
              wrap='nowrap'
              style={{ display: 'flex', alignItems: 'center' }}
            >
              <TopMenuButton
                Icon={IHubIconPlay}
                hoverInfo={runControlState.hoverInfo}
                onClick={handleRunCampaign}
                disabled={isHistoricalView || runControlState.disabled}
                showTooltipWhenDisabled={
                  runControlState.showTooltipWhenDisabled
                }
              />

              <Menu
                position='bottom-end'
                transitionProps={{ transition: 'pop' }}
                withinPortal
                onChange={(opened) => {
                  if (opened) void refreshPriorRuns()
                }}
              >
                <Menu.Target>
                  <ActionIcon
                    size='sm'
                    variant='subtle'
                    aria-label='Run campaign options'
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: '0 4px 4px 0',
                      borderLeft:
                        '1px solid light-dark(var(--mantine-color-gray-3), var(--mantine-color-dark-4))',
                    }}
                  >
                    <IHubIconChevronDown
                      style={{ width: rem(16), height: rem(16) }}
                      stroke={1.5}
                    />
                  </ActionIcon>
                </Menu.Target>

                <Menu.Dropdown
                  className={`${classes.boundedMenuDropdown} ${classes.priorRunsMenuDropdown}`}
                >
                  <Menu.Label>Previous runs</Menu.Label>
                  {historicalRuns.length ? (
                    historicalRuns.map((run) => (
                      <Menu.Item
                        key={run.run_id}
                        onClick={() => void handleSelectHistoricalRun(run)}
                        color={run.run_id === currentRunId ? 'blue' : undefined}
                      >
                        <Stack gap={2}>
                          <Group gap='xs' wrap='nowrap'>
                            <Text size='sm' truncate>
                              {formatLocalDateTime(run.run_at, {
                                dateStyle: 'short',
                                timeStyle: 'short',
                              }) ?? 'Unknown'}
                            </Text>
                            <Text size='xs' c='dimmed' ff='monospace' truncate>
                              {run.run_id.slice(0, 8)}
                            </Text>
                          </Group>
                          <CampaignRunOutcomeLabel run={run} />
                        </Stack>
                      </Menu.Item>
                    ))
                  ) : (
                    <Menu.Item disabled>No previous runs</Menu.Item>
                  )}
                </Menu.Dropdown>
              </Menu>
            </Group>

            <TopMenuButton
              Icon={IHubIconStop}
              hoverInfo={
                isStoppingCampaign
                  ? 'Stopping campaign'
                  : !isExecutingCampaign
                    ? 'No campaign is running'
                    : !activeCampaignBrokerId
                      ? activeCampaignRunId
                        ? 'The active run has no recorded INTERSECT server and cannot be stopped'
                        : 'Waiting for campaign broker id'
                      : !activeCampaignRunId
                        ? 'Waiting for campaign run id'
                        : 'Stop campaign'
              }
              onClick={() => setStopModalOpen(true)}
              disabled={isHistoricalView || !isStopCampaignEnabled}
              showTooltipWhenDisabled={!isStopCampaignEnabled}
            />
          </>
        }
        centerItems={
          <>
            {/* <Input
              type='number'
              min={1}
              step={1}
              value={runIterationsInput}
              onChange={(event) => {
                setRunIterationsInput(event.currentTarget.value)
              }}
              onBlur={() => {
                const parsedIterations = Number.parseInt(runIterationsInput, 10)
                const normalizedIterations = Number.isFinite(parsedIterations)
                  ? Math.max(1, parsedIterations)
                  : 1
                setRunIterationsInput(String(normalizedIterations))
              }}
              placeholder='Iterations'
              size='xs'
              radius='xl'
              w={120}
              aria-label='Campaign iterations'
            /> */}
          </>
        }
        rightItems={
          <>
            {currentRunId && (
              <Badge size='sm' variant='light' color='gray'>
                Run ID: {currentRunId.split('-')[0]}
              </Badge>
            )}
            <CampaignBrokerSelector
              brokers={brokers}
              intersectId={intersectId}
              setIntersectId={setIntersectId}
              disabled={isHistoricalView || isBrokerSelectionLocked}
            />
            <TopMenuButton
              Icon={IHubIconDownload}
              hoverInfo='Download'
              onClick={handleDownloadCampaign}
            />
          </>
        }
        pb={0}
      />

      <CampaignRecoveryUi
        state={recoveryState}
        brokers={brokers}
        selectRun={selectRecoveryRun}
        retry={retryRecovery}
      />

      <div className={classes.campaignBuilder}>
        <CurrentRunIdContext.Provider value={currentRunId}>
          <CampaignEventLogProvider
            value={{
              runId: latestLogRunId,
              runIsLoading: isLatestLogRunLoading,
              runError: latestLogRunError,
              retryRunLookup: retryLatestLogRun,
              refreshSignals: eventLogRefreshSignals,
            }}
          >
            <ReactFlowProvider>
              <div className={classes.campaignWorkspace} ref={workspaceRef}>
                <div
                  className={classes.campaignFlowArea}
                  data-read-only={isHistoricalView ? 'true' : 'false'}
                >
                  {!isHistoricalView &&
                    campaignModel.task_groups.length === 0 && (
                      <CampaignOnboarding
                        brokers={brokers}
                        intersectId={intersectId}
                        setIntersectId={setIntersectId}
                        onCreateTaskGroup={handleCreateTaskGroup}
                        isBrokerSelectionLocked={isBrokerSelectionLocked}
                      />
                    )}
                  <CampaignViewContext.Provider value={campaignViewSettings}>
                    <CapabilityInputDraftProvider
                      value={capabilityInputDraftContextValue}
                    >
                      <CampaignExecutionDisplayProvider
                        nodeStatuses={
                          isHistoricalView
                            ? historicalNodeStatuses
                            : executionState.nodeStatuses
                        }
                        nodeRunCounts={
                          isHistoricalView
                            ? historicalNodeRunCounts
                            : executionState.nodeRunCounts
                        }
                      >
                        <CodeNodeEditorOwnershipProvider
                          inspectedNodeId={inspectedCodeNodeId}
                        >
                          <CampaignCanvas
                            nodes={flowNodes}
                            edges={flowEdges}
                            nodeTypes={nodeTypes}
                            readOnly={isHistoricalView}
                            selectedSheetId={selectedSheetId}
                            sheetViewports={sheetViewports}
                            onSheetViewportChange={onSheetViewportChange}
                            onNodesChange={onModelNodesChange}
                            onEdgesChange={onModelEdgesChange}
                            onNodeDragStop={handleNodeDragStop}
                            onConnectStart={onConnectStart}
                            onConnectEnd={onConnectEnd}
                            onConnect={onConnect}
                            isValidConnection={isValidConnection}
                            onReconnectStart={onReconnectStart}
                            onReconnect={onReconnect}
                            onReconnectEnd={onReconnectEnd}
                            onSelectionChange={handleSelectionChange}
                            onNodeClick={handleNodeClick}
                            onPointerDown={handleCanvasPointerDown}
                            onPaneClick={() => changeSelectedNode(null, false)}
                          />
                        </CodeNodeEditorOwnershipProvider>
                      </CampaignExecutionDisplayProvider>
                    </CapabilityInputDraftProvider>
                  </CampaignViewContext.Provider>
                  <div className={classes.campaignAlertLayer}>
                    {historicalRun && (
                      <Stack gap='xs'>
                        <Alert
                          className={`${classes.historicalRunNotice} ${
                            historicalViewError
                              ? classes.historicalRunNoticeWarning
                              : classes.historicalRunNoticeInfo
                          }`}
                          color={historicalViewError ? 'yellow' : 'blue'}
                        >
                          <Group justify='space-between' gap='sm'>
                            <Text
                              size='sm'
                              className={classes.historicalRunNoticeText}
                            >
                              <Text span inherit fw={600}>
                                {historicalViewError
                                  ? 'Historical campaign unavailable'
                                  : isHistoricalViewLoading
                                    ? 'Loading historical campaign'
                                    : 'Viewing immutable campaign'}
                              </Text>{' '}
                              ·{' '}
                              {historicalViewError ??
                                (isHistoricalViewLoading
                                  ? `Run ${historicalRun.run_id.slice(0, 8)}`
                                  : isLegacyHistoricalRun
                                    ? `Run ${historicalRun.run_id.slice(0, 8)} originated in the retired legacy format. The executed canonical representation is displayed read-only.`
                                    : `Run ${historicalRun.run_id.slice(0, 8)}, executed ${
                                        formatLocalDateTime(
                                          historicalRun.run_at,
                                        ) ?? 'Unknown'
                                      }`)}
                            </Text>
                            <Group gap='xs' wrap='nowrap'>
                              {historicalCampaignModel &&
                                !isLegacyHistoricalRun && (
                                  <Button
                                    size='xs'
                                    variant='light'
                                    onClick={() =>
                                      setRestoreHistoricalModalOpen(true)
                                    }
                                  >
                                    Set as current version
                                  </Button>
                                )}
                              <Button
                                size='xs'
                                variant='subtle'
                                onClick={closeHistoricalView}
                              >
                                Return to current
                              </Button>
                            </Group>
                          </Group>
                        </Alert>
                        {!historicalViewError && historicalCampaignModel && (
                          <Alert
                            className={classes.historicalRunNotice}
                            color={
                              historicalRecoveryError
                                ? 'yellow'
                                : historicalRun.outcome === 'FAILED' ||
                                    historicalErrors.length > 0
                                  ? 'red'
                                  : historicalRun.outcome === 'SUCCEEDED'
                                    ? 'green'
                                    : historicalRun.status === 'ACTIVE'
                                      ? 'blue'
                                      : 'yellow'
                            }
                          >
                            <Group justify='space-between' gap='sm'>
                              <Stack gap={2}>
                                <CampaignRunOutcomeLabel run={historicalRun} />
                                <Text size='sm'>
                                  {historicalRecoveryError
                                    ? `Execution history unavailable · ${historicalRecoveryError}`
                                    : isHistoricalRecoveryLoading
                                      ? 'Loading execution history'
                                      : historicalErrors.length > 0
                                        ? `${historicalErrors.length} error${historicalErrors.length === 1 ? '' : 's'} recorded · ${historicalErrors[0]!.message}`
                                        : historicalRun.outcome === 'FAILED'
                                          ? 'No error details were recorded.'
                                          : 'No error events were recorded.'}
                                </Text>
                              </Stack>
                              {historicalRecoveryError ? (
                                <Button
                                  size='xs'
                                  variant='light'
                                  loading={isHistoricalRecoveryLoading}
                                  onClick={() => void retryHistoricalRecovery()}
                                >
                                  Retry
                                </Button>
                              ) : (
                                (historicalErrors.length > 0 ||
                                  historicalRun.outcome === 'FAILED') && (
                                  <Button
                                    size='xs'
                                    variant='light'
                                    onClick={() => setRunErrorsDrawerOpen(true)}
                                  >
                                    View errors
                                  </Button>
                                )
                              )}
                            </Group>
                          </Alert>
                        )}
                      </Stack>
                    )}
                    {executionError && (
                      <Alert
                        className={classes.executionError}
                        color='red'
                        title='Campaign could not start'
                        withCloseButton
                        onClose={dismissExecutionError}
                      >
                        {executionError}
                      </Alert>
                    )}
                  </div>
                </div>
                {sidePanelState.mode !== 'closed' && workspaceWidth > 0 && (
                  <CampaignSidePanel
                    ariaLabel={
                      sidePanelState.mode === 'overview'
                        ? 'Nodes List'
                        : 'Task inspector'
                    }
                    width={inspectorWidth}
                    workspaceWidth={workspaceWidth}
                    onWidthChange={setInspectorWidth}
                  >
                    {sidePanelState.mode === 'overview' ? (
                      <CampaignAllNodes
                        groups={allNodesGroups}
                        headingRef={allNodesHeadingRef}
                        onClose={handleCloseAllNodes}
                        onSelectNode={handleSelectAllNodesEntry}
                        registerRow={registerAllNodesRow}
                      />
                    ) : (
                      selectedNode && (
                        <CampaignViewContext.Provider
                          value={campaignViewSettings}
                        >
                          <CapabilityInputDraftProvider
                            value={capabilityInputDraftContextValue}
                          >
                            <CampaignExecutionDisplayProvider
                              nodeStatuses={
                                isHistoricalView
                                  ? historicalNodeStatuses
                                  : executionState.nodeStatuses
                              }
                              nodeRunCounts={
                                isHistoricalView
                                  ? historicalNodeRunCounts
                                  : executionState.nodeRunCounts
                              }
                            >
                              <CampaignNodeInspector
                                node={selectedNode}
                                headingRef={inspectorHeadingRef}
                                projectId={projectId}
                                jupyterServers={jupyterServers}
                                onBack={handleOpenNodesList}
                                backLabel={
                                  sidePanelState.source === 'overview'
                                    ? 'Back to Nodes List'
                                    : 'Nodes List'
                                }
                                onClose={handleCloseInspector}
                                onDelete={handleRemoveTask}
                              />
                            </CampaignExecutionDisplayProvider>
                          </CapabilityInputDraftProvider>
                        </CampaignViewContext.Provider>
                      )
                    )}
                  </CampaignSidePanel>
                )}
              </div>
            </ReactFlowProvider>
          </CampaignEventLogProvider>

          {!isHistoricalView && selectedTaskGroup && (
            <TaskGroupObjectivesEditor
              taskGroupLabel={
                tabs.find((tab) => tab.id === selectedTaskGroup.id)?.label ??
                'Task Group'
              }
              accentColor={selectedTaskGroupThemeColor}
              objectives={selectedTaskGroupUnifiedObjectives}
              assertVariableOptions={selectedTaskGroupAssertVariableOptions}
              thresholdVariableOptions={selectedTaskGroupNumericVariableOptions}
              onAddObjective={handleAddTaskGroupObjective}
              onChangeObjectiveKind={handleChangeUnifiedObjectiveKind}
              onUpdateAssertObjective={handleUpdateAssertObjective}
              onUpdateIterateObjective={handleUpdateIterateObjective}
              onUpdateThresholdObjective={handleUpdateThresholdObjective}
              onRemoveObjective={handleRemoveUnifiedObjective}
            />
          )}

          <CampaignSheetTabs
            campaignModel={campaignModel}
            tabs={tabs}
            selectedSheetId={selectedSheetId}
            masterSheetId={masterCampaignSheetId}
            nodeStatuses={
              isHistoricalView
                ? historicalNodeStatuses
                : executionState.nodeStatuses
            }
            nodeRunCounts={
              isHistoricalView
                ? historicalNodeRunCounts
                : executionState.nodeRunCounts
            }
            addTaskGroupDisabled={
              isHistoricalView ||
              (campaignModel.task_groups.length === 0 && !intersectId)
            }
            onSelectSheet={handleSelectSheet}
            onAddTaskGroup={handleCreateTaskGroup}
          />
        </CurrentRunIdContext.Provider>
      </div>
    </div>
  )
}
