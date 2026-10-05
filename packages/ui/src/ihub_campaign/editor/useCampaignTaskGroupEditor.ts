import type {
  Capability,
  CampaignModel,
  CampaignObjectiveAssert,
  CampaignObjectiveIterate,
  CampaignObjectiveThreshold,
} from '@ihub/utils/types/campaign'
import type { ComboboxData } from '@mantine/core'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from 'react'

import {
  addTaskGroupObjective,
  changeUnifiedObjectiveKind,
  encodeObjectiveVariableOptionValue,
  getUnifiedObjectives,
  isBooleanObjectiveValueType,
  isNumericObjectiveValueType,
  removeUnifiedObjective,
  updateAssertObjective,
  updateIterateObjective,
  updateThresholdObjective,
  type UnifiedObjectiveEntry,
  type UnifiedObjectiveKind,
} from '../model/objectiveOperations'
import { getCampaignModelTabs, getCampaignTaskGroup } from '../model/selectors'
import {
  addCampaignTask,
  addCampaignTaskGroup,
  createCampaignTaskGroup,
  createCapabilityTask,
  createEventTask,
  createJsonFileTask,
  createJsonTextTask,
  createRendererTask,
  createVisualizationTask,
} from '../model/taskOperations'
import {
  collectTaskOutputVariableGroups,
  type TaskGroupOutputVariableGroup,
} from './taskOutputVariables'
import {
  masterCampaignSheetId,
  resolveCampaignSheetId,
} from './campaignEditorState'

function getTaskOutputGroupLabel(group: TaskGroupOutputVariableGroup): string {
  return `From ${group.taskLabel} [${group.taskId.slice(0, 8)}]`
}

export function getTaskGroupThemeColor(taskGroupId: string): string {
  const colors = [
    '#1f6feb',
    '#2f9e44',
    '#e67700',
    '#c2255c',
    '#0b7285',
    '#5f3dc4',
  ]
  const hash = [...taskGroupId].reduce(
    (sum, char) => sum + char.charCodeAt(0),
    0,
  )
  return colors[hash % colors.length] ?? colors[0]!
}

/** Owns task-group selection, derived objective inputs, and domain mutations. */
export function useCampaignTaskGroupEditor({
  campaignModel,
  persistCampaignModel,
  latestCampaignModelRef,
  selectedSheetId: controlledSelectedSheetId,
  onSelectedSheetIdChange,
}: {
  campaignModel: CampaignModel
  persistCampaignModel: (campaignModel: CampaignModel) => void
  latestCampaignModelRef: MutableRefObject<CampaignModel>
  selectedSheetId?: string
  onSelectedSheetIdChange?: (sheetId: string) => void
}) {
  const [internalSelectedSheetId, setInternalSelectedSheetId] = useState(
    masterCampaignSheetId,
  )
  const isSelectionControlled = onSelectedSheetIdChange !== undefined
  const selectedSheetId = isSelectionControlled
    ? (controlledSelectedSheetId ?? masterCampaignSheetId)
    : internalSelectedSheetId
  const setSelectedSheetId = useCallback(
    (sheetId: string) => {
      setInternalSelectedSheetId(sheetId)
      onSelectedSheetIdChange?.(sheetId)
    },
    [onSelectedSheetIdChange],
  )
  const tabs = useMemo(
    () => getCampaignModelTabs(campaignModel),
    [campaignModel],
  )

  useEffect(() => {
    const nextSheetId = resolveCampaignSheetId(tabs, selectedSheetId)
    if (nextSheetId !== selectedSheetId) {
      setSelectedSheetId(nextSheetId)
    }
  }, [selectedSheetId, setSelectedSheetId, tabs])

  const selectedTaskGroupId =
    selectedSheetId === masterCampaignSheetId ? null : selectedSheetId
  const latestSelectedTaskGroupIdRef = useRef(selectedTaskGroupId)
  latestSelectedTaskGroupIdRef.current = selectedTaskGroupId
  const selectedTaskGroup = useMemo(
    () => getCampaignTaskGroup(campaignModel, selectedTaskGroupId),
    [campaignModel, selectedTaskGroupId],
  )
  const outputGroups = useMemo(
    () =>
      selectedTaskGroup
        ? collectTaskOutputVariableGroups(selectedTaskGroup.tasks)
        : [],
    [selectedTaskGroup],
  )
  const selectedTaskGroupAssertVariableOptions = useMemo<ComboboxData>(
    () =>
      outputGroups.map((group) => ({
        group: getTaskOutputGroupLabel(group),
        items: group.variables
          .sort((a, b) => a.path.localeCompare(b.path))
          .map((variable) => ({
            value: encodeObjectiveVariableOptionValue(
              group.taskId,
              variable.path,
            ),
            label: variable.label,
            disabled: !isBooleanObjectiveValueType(variable.valueType),
          })),
      })),
    [outputGroups],
  )
  const selectedTaskGroupNumericVariableOptions = useMemo<ComboboxData>(
    () =>
      outputGroups
        .map((group) => ({
          group: getTaskOutputGroupLabel(group),
          items: group.variables
            .filter((variable) =>
              isNumericObjectiveValueType(variable.valueType),
            )
            .sort((a, b) => a.path.localeCompare(b.path))
            .map((variable) => ({
              value: encodeObjectiveVariableOptionValue(
                group.taskId,
                variable.path,
              ),
              label: variable.label,
            })),
        }))
        .filter((group) => group.items.length > 0),
    [outputGroups],
  )
  const selectedTaskGroupThemeColor = useMemo(
    () =>
      selectedTaskGroupId
        ? getTaskGroupThemeColor(selectedTaskGroupId)
        : '#1f6feb',
    [selectedTaskGroupId],
  )
  const selectedTaskGroupUnifiedObjectives = useMemo<UnifiedObjectiveEntry[]>(
    () => getUnifiedObjectives(campaignModel, selectedTaskGroupId),
    [campaignModel, selectedTaskGroupId],
  )

  const persistDomainUpdate = useCallback(
    (nextCampaignModel: CampaignModel) => {
      if (nextCampaignModel !== latestCampaignModelRef.current) {
        persistCampaignModel(nextCampaignModel)
      }
    },
    [latestCampaignModelRef, persistCampaignModel],
  )
  const addSelectedTask = useCallback(
    (createTask: () => Parameters<typeof addCampaignTask>[2]) => {
      if (!selectedTaskGroupId) return
      persistCampaignModel(
        addCampaignTask(
          latestCampaignModelRef.current,
          selectedTaskGroupId,
          createTask(),
        ),
      )
    },
    [latestCampaignModelRef, persistCampaignModel, selectedTaskGroupId],
  )

  const handleAddTaskGroup = useCallback(() => {
    const nextTaskGroup = createCampaignTaskGroup()
    persistCampaignModel(
      addCampaignTaskGroup(latestCampaignModelRef.current, nextTaskGroup),
    )
    setSelectedSheetId(nextTaskGroup.id)
  }, [latestCampaignModelRef, persistCampaignModel, setSelectedSheetId])
  const handleAddCapabilityTask = useCallback(
    (capability: Capability, endpoint: string) =>
      addSelectedTask(() => createCapabilityTask(capability, endpoint)),
    [addSelectedTask],
  )
  const handleAddEventTask = useCallback(
    (capability: Capability, eventName: string) =>
      addSelectedTask(() => createEventTask(capability, eventName)),
    [addSelectedTask],
  )
  const handleAddVisualizationTask = useCallback(
    (visualizationType: string, visualizationName: string) =>
      addSelectedTask(() =>
        createVisualizationTask(visualizationType, visualizationName),
      ),
    [addSelectedTask],
  )
  const handleAddRendererTask = useCallback(
    (rendererType: string, rendererName: string) =>
      addSelectedTask(() => createRendererTask(rendererType, rendererName)),
    [addSelectedTask],
  )
  const handleAddJsonFileTask = useCallback(
    () => addSelectedTask(createJsonFileTask),
    [addSelectedTask],
  )
  const handleAddJsonTextTask = useCallback(
    () => addSelectedTask(createJsonTextTask),
    [addSelectedTask],
  )
  const handleAddTaskGroupObjective = useCallback(() => {
    if (!selectedTaskGroupId) return
    persistDomainUpdate(
      addTaskGroupObjective(
        latestCampaignModelRef.current,
        selectedTaskGroupId,
      ),
    )
  }, [latestCampaignModelRef, persistDomainUpdate, selectedTaskGroupId])
  const handleChangeUnifiedObjectiveKind = useCallback(
    (
      objectiveId: string,
      scope: UnifiedObjectiveEntry['scope'],
      kind: UnifiedObjectiveKind,
    ) => {
      if (!selectedTaskGroupId) return
      persistDomainUpdate(
        changeUnifiedObjectiveKind(
          latestCampaignModelRef.current,
          selectedTaskGroupId,
          objectiveId,
          scope,
          kind,
        ),
      )
    },
    [latestCampaignModelRef, persistDomainUpdate, selectedTaskGroupId],
  )
  const handleUpdateAssertObjective = useCallback(
    (objectiveId: string, patch: Partial<CampaignObjectiveAssert>) => {
      if (!selectedTaskGroupId) return
      persistDomainUpdate(
        updateAssertObjective(
          latestCampaignModelRef.current,
          selectedTaskGroupId,
          objectiveId,
          patch,
        ),
      )
    },
    [latestCampaignModelRef, persistDomainUpdate, selectedTaskGroupId],
  )
  const handleUpdateIterateObjective = useCallback(
    (objectiveId: string, patch: Partial<CampaignObjectiveIterate>) => {
      if (!selectedTaskGroupId) return
      persistDomainUpdate(
        updateIterateObjective(
          latestCampaignModelRef.current,
          selectedTaskGroupId,
          objectiveId,
          patch,
        ),
      )
    },
    [latestCampaignModelRef, persistDomainUpdate, selectedTaskGroupId],
  )
  const handleUpdateThresholdObjective = useCallback(
    (objectiveId: string, patch: Partial<CampaignObjectiveThreshold>) => {
      persistDomainUpdate(
        updateThresholdObjective(
          latestCampaignModelRef.current,
          objectiveId,
          patch,
        ),
      )
    },
    [latestCampaignModelRef, persistDomainUpdate],
  )
  const handleRemoveUnifiedObjective = useCallback(
    (objectiveId: string, scope: UnifiedObjectiveEntry['scope']) => {
      if (!selectedTaskGroupId) return
      persistDomainUpdate(
        removeUnifiedObjective(
          latestCampaignModelRef.current,
          selectedTaskGroupId,
          objectiveId,
          scope,
        ),
      )
    },
    [latestCampaignModelRef, persistDomainUpdate, selectedTaskGroupId],
  )

  return {
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
  }
}
