/**
 * Provides the React hook that manages capability input mappings, including
 * upstream output selection, manual value entry, and persistence to campaign
 * node and edge state.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ComboboxData } from '@mantine/core'
import type { CampaignEdge } from '@ihub/utils/types/campaign'
import type { VariableItem } from '@ihub/utils/types/types'
import {
  useCampaignActions,
  useCampaignStoreSelector,
} from '../../state/campaignContext'
import {
  buildPotentialOptions,
  type CampaignNodeWithData,
  comboboxDataHasEnabledOption,
  getUpstreamOptionCompatibility,
  parseUpstreamOptionValue,
} from '../upstream/variableOptions'
import {
  dataMappingsAreEqual,
  getManualInputValues,
  getSelectedUpstreamValueForTarget,
  parseManualInputValue,
  removeMappingsForTargetParameter,
  upsertMappingForTargetParameter,
} from './inputMapping'
import {
  type CapabilityManualValueOwnership,
  type CapabilityInputSourceMode,
  createCapabilityInputViewState,
  getCapabilityInputSourceMode,
  getDisplayedCapabilityInputViewState,
  getManualValueDisplay,
  synchronizeCapabilityManualValue,
} from './inputSource'
import { useCapabilityInputDrafts } from '../../state/capabilityInputDraftContext'
import { useCapabilityInputSourceOverride } from '../../state/capabilityInputSourceOverrideContext'

type UseCapabilityInputMappingArgs = {
  nodeId: string
  input: VariableItem
  parentsOutputItems?: Record<string, VariableItem[]>
  parentNodes?: CampaignNodeWithData[]
  provenanceKey: string
  readOnly: boolean
  canMutate: (scheduledProvenanceKey?: string) => boolean
}

type UseCapabilityInputMappingResult = {
  potentialOptions: ComboboxData
  hasUpstreamOptions: boolean
  inputSource: CapabilityInputSourceMode
  selectedValue: string | null
  manualValue: string
  handleSourceChange: (nextSource: CapabilityInputSourceMode) => void
  handleUpstreamValueChange: (value: string | null) => void
  handleManualValueChange: (value: string) => void
  flushManualValue: () => void
}

/**
 * Owns capability input source state and synchronizes it with campaign graph
 * edge mappings and persisted manual values.
 */
export function useCapabilityInputMapping({
  nodeId,
  input,
  parentsOutputItems,
  parentNodes = [],
  provenanceKey,
  readOnly,
  canMutate,
}: UseCapabilityInputMappingArgs): UseCapabilityInputMappingResult {
  const persistedManual = useCampaignStoreSelector(
    (snapshot) => {
      const node = snapshot.state.nodes.find(
        (candidate) => candidate.id === nodeId,
      )
      const values = getManualInputValues(
        node as CampaignNodeWithData | undefined,
      )
      return {
        hasValue: Object.hasOwn(values, input.path),
        value: values[input.path],
      }
    },
    (left, right) =>
      left.hasValue === right.hasValue && Object.is(left.value, right.value),
  )
  const campaignEdges = useCampaignStoreSelector(
    (snapshot) =>
      (snapshot.state.edges as CampaignEdge[]).filter(
        (edge) => edge.target === nodeId,
      ),
    (left, right) =>
      left.length === right.length &&
      left.every((edge, index) => edge === right[index]),
  )
  const { updateEdgeData } = useCampaignActions()
  const { stageCapabilityInputDraft, flushCapabilityInputDrafts } =
    useCapabilityInputDrafts()
  const manualValueOwnershipRef = useRef<CapabilityManualValueOwnership>(null)
  const [inputSourceOverride, setInputSourceOverride] =
    useCapabilityInputSourceOverride({
      provenanceKey,
      nodeId,
      inputPath: input.path,
    })

  const manualInputValues = useMemo(
    () =>
      persistedManual.hasValue ? { [input.path]: persistedManual.value } : {},
    [input.path, persistedManual],
  )
  const existingManual = persistedManual.value
  const displayedManualValue = getManualValueDisplay(
    existingManual,
    input.default,
  )

  const potentialOptions = useMemo<ComboboxData>(() => {
    return buildPotentialOptions(parentsOutputItems, parentNodes, input)
  }, [input, parentNodes, parentsOutputItems])
  const hasUpstreamOptions = comboboxDataHasEnabledOption(potentialOptions)
  const selectedUpstreamValue = useMemo(() => {
    return getSelectedUpstreamValueForTarget(campaignEdges, nodeId, input.path)
  }, [campaignEdges, input.path, nodeId])
  const initialViewState = createCapabilityInputViewState({
    persistedValue: existingManual,
    defaultValue: input.default,
    selectedUpstreamValue,
    manualInputValues,
    inputPath: input.path,
    hasUpstreamOptions,
  })
  const [manualValue, setManualValue] = useState(initialViewState.manualValue)
  const [selectedValue, setSelectedValue] = useState<string | null>(
    initialViewState.selectedValue,
  )
  const inputSource = getCapabilityInputSourceMode({
    selectedUpstreamValue,
    manualInputValues,
    inputPath: input.path,
    hasUpstreamOptions,
    userInputSourceOverride: readOnly ? null : inputSourceOverride,
  })
  const displayedViewState = getDisplayedCapabilityInputViewState(
    initialViewState,
    {
      inputSource,
      manualValue,
      selectedValue,
    },
    readOnly,
  )

  const clearMappingsForTarget = useCallback(() => {
    if (!canMutate(provenanceKey)) return

    const incomingEdges = campaignEdges.filter((edge) => edge.target === nodeId)
    incomingEdges.forEach((edge) => {
      const existingData = edge?.data || {}
      const filtered = removeMappingsForTargetParameter(
        existingData.data_mapping || [],
        input.path,
      )
      if (!dataMappingsAreEqual(existingData.data_mapping || [], filtered)) {
        updateEdgeData(edge.id, { ...existingData, data_mapping: filtered })
      }
    })
  }, [
    campaignEdges,
    canMutate,
    input.path,
    nodeId,
    provenanceKey,
    updateEdgeData,
  ])

  useEffect(() => {
    manualValueOwnershipRef.current = null
  }, [input.path, nodeId, provenanceKey])

  useEffect(() => {
    if (readOnly) return

    setManualValue((previous) => {
      if (
        manualValueOwnershipRef.current?.kind === 'editing' &&
        Object.is(
          existingManual,
          parseManualInputValue(manualValueOwnershipRef.current.displayValue),
        )
      ) {
        manualValueOwnershipRef.current = {
          kind: 'persisting',
          persistedValue: existingManual,
        }
      }
      const synchronization = synchronizeCapabilityManualValue({
        currentManualValue: previous,
        displayedManualValue,
        persistedValue: existingManual,
        ownership: manualValueOwnershipRef.current,
      })
      manualValueOwnershipRef.current = synchronization.ownership
      return synchronization.manualValue
    })
  }, [displayedManualValue, existingManual, provenanceKey, readOnly])

  useEffect(() => {
    if (readOnly) return

    setSelectedValue((prev) =>
      prev === selectedUpstreamValue ? prev : selectedUpstreamValue,
    )
  }, [provenanceKey, readOnly, selectedUpstreamValue])

  useEffect(() => {
    if (!canMutate(provenanceKey)) return

    const targetPath = input.path

    if (!nodeId) return

    if (inputSource !== 'upstream' || !selectedValue) {
      if (!selectedUpstreamValue) {
        clearMappingsForTarget()
      }
      return
    }

    const selectedCompatibility = getUpstreamOptionCompatibility({
      value: selectedValue,
      targetInput: input,
      parentsOutputItems,
    })

    if (selectedCompatibility === 'unresolved') {
      return
    }

    if (selectedCompatibility === 'incompatible') {
      clearMappingsForTarget()
      setSelectedValue((prev) => (prev === selectedValue ? null : prev))
      return
    }

    const { sourceNodeId, sourcePath } = parseUpstreamOptionValue(selectedValue)

    const chosenEdge = campaignEdges.find(
      (edge) => edge.source === sourceNodeId && edge.target === nodeId,
    )
    if (!chosenEdge) {
      console.warn(
        'No campaign edge found for source node',
        sourceNodeId,
        'target',
        nodeId,
      )
      return
    }

    const newMapping = {
      source_parameter: sourcePath,
      target_parameter: targetPath,
    }

    const chosenExisting = chosenEdge?.data || {}
    const chosenDataMapping = upsertMappingForTargetParameter(
      chosenExisting.data_mapping || [],
      newMapping,
    )
    const chosenUpdated = {
      ...chosenExisting,
      data_mapping: chosenDataMapping,
    }
    if (
      !dataMappingsAreEqual(
        chosenExisting.data_mapping || [],
        chosenUpdated.data_mapping,
      )
    ) {
      updateEdgeData(chosenEdge.id, chosenUpdated)
    }

    const otherIncoming =
      campaignEdges.filter(
        (edge) => edge.target === nodeId && edge.id !== chosenEdge.id,
      ) || []
    otherIncoming.forEach((edge) => {
      const existingData = edge?.data || {}
      const filtered = removeMappingsForTargetParameter(
        existingData.data_mapping || [],
        targetPath,
      )
      if (!dataMappingsAreEqual(existingData.data_mapping || [], filtered)) {
        updateEdgeData(edge.id, { ...existingData, data_mapping: filtered })
      }
    })
  }, [
    campaignEdges,
    canMutate,
    clearMappingsForTarget,
    input,
    inputSource,
    nodeId,
    parentsOutputItems,
    provenanceKey,
    readOnly,
    selectedUpstreamValue,
    selectedValue,
    updateEdgeData,
  ])

  const handleSourceChange = useCallback(
    (nextSource: CapabilityInputSourceMode) => {
      if (!canMutate(provenanceKey)) return

      setInputSourceOverride(nextSource)

      if (nextSource === 'custom') {
        setSelectedValue(null)
        clearMappingsForTarget()
      }
    },
    [canMutate, clearMappingsForTarget, provenanceKey, setInputSourceOverride],
  )

  const handleUpstreamValueChange = useCallback(
    (value: string | null) => {
      if (!canMutate(provenanceKey)) return

      setInputSourceOverride('upstream')
      setSelectedValue(value)
      if (!value) {
        clearMappingsForTarget()
      }
    },
    [canMutate, clearMappingsForTarget, provenanceKey, setInputSourceOverride],
  )
  const handleManualValueChange = useCallback(
    (value: string) => {
      if (!canMutate(provenanceKey)) return
      manualValueOwnershipRef.current = { kind: 'editing', displayValue: value }
      setManualValue(value)
      stageCapabilityInputDraft({
        provenanceKey,
        taskId: nodeId,
        inputPath: input.path,
        displayValue: value,
      })
    },
    [canMutate, input.path, nodeId, provenanceKey, stageCapabilityInputDraft],
  )
  const flushManualValue = useCallback(() => {
    if (!canMutate(provenanceKey)) return
    flushCapabilityInputDrafts()
  }, [canMutate, flushCapabilityInputDrafts, provenanceKey])

  return {
    potentialOptions,
    hasUpstreamOptions,
    inputSource: displayedViewState.inputSource,
    selectedValue: displayedViewState.selectedValue,
    manualValue: displayedViewState.manualValue,
    handleSourceChange,
    handleUpstreamValueChange,
    handleManualValueChange,
    flushManualValue,
  }
}
