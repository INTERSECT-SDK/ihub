import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { JupyterSession } from '@ihub/utils/types/notebook'
import type { JupyterServerConfig } from '@ihub/utils/types/notebook'
import type { CampaignNode, EventNode } from '@ihub/utils/types/campaign'

import { fetchKernelVariableValue } from '../../../ihub_notebook/fetchKernelValue'
import { fetchLatestStepCompleteEvent } from '../../execution/eventLogs'
import {
  useCampaignDisplayNodeRunCounts,
  useCampaignDisplayNodeStatuses,
  useCampaignExecution,
} from '../../state/executionContext'
import { CurrentRunIdContext } from '../../state/currentRunContext'
import type { CampaignNodeWithData } from '../upstream/variableOptions'
import type { VisualizationMappingState } from './VisualizationMapping'
import { countVisualizationMappings } from './VisualizationMapping'
import {
  getVisualizationNodeStatusUpdate,
  shouldShowVisualizationResolvingStatus,
  type VisualizationResolutionPhase,
} from './VisualizationNodeStatus'
import {
  getCompletedOutputIteration,
  getVisibleResolvedVisualizationData,
  type ResolvedVisualizationData,
} from './resolvedVisualizationData'
import { resolvePersistedEventPayloadValue } from './persistedEventPayload'
import { getCapabilityEventSchemaDocument } from '../event/eventSchema'
import { createJsonFileNodeValueResolver } from '../json-file/jsonFile'
import { createJsonTextNodeValueResolver } from '../json-text/jsonText'
import { resolveJsonNodeMappingValue } from './jsonNodeResolution'

const EMPTY_JUPYTER_SERVERS: JupyterServerConfig[] = []

/** Resolves mapped upstream values and maintains visualization execution status. */
export function useVisualizationResolution({
  id,
  mappings,
  campaignNodes,
  parentCodeNodeConnectionsRef,
  jupyterServers = EMPTY_JUPYTER_SERVERS,
}: {
  id: string
  mappings: VisualizationMappingState
  campaignNodes: CampaignNodeWithData[]
  parentCodeNodeConnectionsRef: React.MutableRefObject<
    Record<string, WebSocket>
  >
  jupyterServers?: JupyterServerConfig[]
}) {
  const [resolution, setResolution] = useState<ResolvedVisualizationData>({
    runId: null,
    data: {},
    sourceIterations: {},
  })
  const currentRunId = useContext(CurrentRunIdContext)
  const { state: executionState, setNodeStatus } = useCampaignExecution()
  const displayNodeStatuses = useCampaignDisplayNodeStatuses()
  const displayNodeRunCounts = useCampaignDisplayNodeRunCounts()
  const displayExecutionRef = useRef({
    nodeStatuses: displayNodeStatuses,
    nodeRunCounts: displayNodeRunCounts,
  })
  displayExecutionRef.current = {
    nodeStatuses: displayNodeStatuses,
    nodeRunCounts: displayNodeRunCounts,
  }
  const mappedInputCount = countVisualizationMappings(mappings)
  const resolveJsonFileNodeValue = useMemo(
    () => createJsonFileNodeValueResolver(jupyterServers),
    [jupyterServers],
  )
  const resolveJsonTextNodeValue = useMemo(
    () => createJsonTextNodeValueResolver(),
    [],
  )

  /** Unique, sorted source node IDs referenced by visualization mappings. */
  const mappedSourceNodeIds = useMemo(() => {
    const ids = new Set<string>()
    Object.values(mappings).forEach((mapping) => {
      if (typeof mapping === 'string' || !mapping?.sourceNodeId) return
      ids.add(mapping.sourceNodeId)
    })
    return [...ids].sort()
  }, [mappings])

  /** Whether any visualization input is mapped to a capability node output. */
  const hasMappedCapabilityInputs = useMemo(
    () =>
      Object.values(mappings).some((mapping) => {
        if (typeof mapping === 'string' || !mapping?.sourceNodeId) return false
        return campaignNodes.some(
          (node) =>
            node.id === mapping.sourceNodeId &&
            (node.type === 'capability' || node.type === 'event'),
        )
      }),
    [campaignNodes, mappings],
  )
  /**
   * Stable signature of mapped parent completion states used to trigger input
   * resolution when a source node completes.
   */
  const mappedParentCompletionSignature = useMemo(
    () =>
      mappedSourceNodeIds
        .map((sourceNodeId) =>
          displayNodeStatuses[sourceNodeId] === 'complete'
            ? `${sourceNodeId}:complete`
            : `${sourceNodeId}:pending`,
        )
        .join('|'),
    [displayNodeStatuses, mappedSourceNodeIds],
  )
  const mappedSourceExecutionSignature = useMemo(
    () =>
      mappedSourceNodeIds
        .map(
          (sourceNodeId) =>
            `${sourceNodeId}:${displayNodeStatuses[sourceNodeId] ?? 'idle'}:${displayNodeRunCounts[sourceNodeId] ?? 0}`,
        )
        .join('|'),
    [displayNodeRunCounts, displayNodeStatuses, mappedSourceNodeIds],
  )
  const completedMappedSourceNodeIds = useMemo(
    () =>
      new Set(
        mappedParentCompletionSignature
          .split('|')
          .filter((entry) => entry.endsWith(':complete'))
          .map((entry) => entry.slice(0, -':complete'.length)),
      ),
    [mappedParentCompletionSignature],
  )

  /**
   * Resolves mapped visualization inputs from literal values, live code kernels,
   * and completed capability outputs when the node mounts, mappings change,
   * or mapped parent nodes complete.
   */
  useEffect(() => {
    let cancelled = false
    const setLocalVisualizationStatus = (
      phase: VisualizationResolutionPhase,
      hasPendingCapabilityInputs: boolean,
    ) => {
      setNodeStatus(
        id,
        getVisualizationNodeStatusUpdate({
          currentRunId,
          mappedInputCount,
          phase,
          hasPendingCapabilityInputs,
        }),
      )
    }

    const resolveValues = async () => {
      const nextData: Record<string, unknown> = {}
      const nextSourceIterations: Record<string, number> = {}
      let hasResolutionError = false
      const hasPendingCapabilityInputs = Object.values(mappings).some(
        (mapping) => {
          if (typeof mapping === 'string' || !mapping?.sourceNodeId)
            return false
          const sourceNode = campaignNodes.find(
            (node) => node.id === mapping.sourceNodeId,
          )
          return (
            (sourceNode?.type === 'capability' ||
              sourceNode?.type === 'event') &&
            !completedMappedSourceNodeIds.has(mapping.sourceNodeId)
          )
        },
      )

      if (
        shouldShowVisualizationResolvingStatus(executionState.campaignStatus)
      ) {
        setLocalVisualizationStatus('resolving', hasPendingCapabilityInputs)
      }

      for (const [inputKey, mapping] of Object.entries(mappings)) {
        if (typeof mapping === 'string') {
          nextData[inputKey] = mapping
          continue
        }
        if (!mapping?.sourceNodeId || typeof mapping.sourcePath !== 'string')
          continue
        const sourceNode = campaignNodes.find(
          (node) => node.id === mapping.sourceNodeId,
        )

        if (
          sourceNode?.type === 'json-file' ||
          sourceNode?.type === 'json-text'
        ) {
          try {
            nextData[inputKey] = await resolveJsonNodeMappingValue(
              sourceNode as CampaignNode,
              mapping.sourcePath,
              { resolveJsonFileNodeValue, resolveJsonTextNodeValue },
            )
          } catch (error) {
            console.error(
              `Failed to resolve ${mapping.sourcePath} from ${mapping.sourceNodeId}:`,
              error,
            )
            hasResolutionError = true
          }
        }

        if (sourceNode?.type === 'code') {
          const connection =
            parentCodeNodeConnectionsRef.current[mapping.sourceNodeId]
          const kernel = sourceNode.data?.kernel as JupyterSession | undefined
          if (
            connection &&
            connection.readyState === WebSocket.OPEN &&
            kernel?.id
          ) {
            try {
              nextData[inputKey] = await fetchKernelVariableValue(
                connection,
                kernel.id,
                mapping.sourcePath,
              )
            } catch (error) {
              console.error(
                `Failed to fetch ${mapping.sourcePath} from ${mapping.sourceNodeId}:`,
                error,
              )
              hasResolutionError = true
            }
          }
        }

        if (sourceNode?.type === 'capability' || sourceNode?.type === 'event') {
          if (!currentRunId) continue

          try {
            const stepCompleteEvent = await fetchLatestStepCompleteEvent(
              currentRunId,
              sourceNode.id,
            )
            if (stepCompleteEvent) {
              const persistedEvent = stepCompleteEvent.payload?.event
              const serializedPayload =
                persistedEvent && typeof persistedEvent === 'object'
                  ? ((persistedEvent as Record<string, unknown>).payload ??
                    '{}')
                  : '{}'
              const selectedPath = mapping.sourcePath.includes(':::')
                ? mapping.sourcePath.split(':::')[1]
                : mapping.sourcePath
              if (selectedPath) {
                const resolvedValue =
                  sourceNode.type === 'event'
                    ? resolvePersistedEventPayloadValue(
                        String(serializedPayload),
                        selectedPath,
                        (sourceNode.data as EventNode).event_schema,
                        getCapabilityEventSchemaDocument(
                          (sourceNode.data as EventNode).capability,
                        ),
                      )
                    : (
                        JSON.parse(String(serializedPayload)) as Record<
                          string,
                          unknown
                        >
                      )[selectedPath]
                if (resolvedValue !== undefined) {
                  nextData[inputKey] = resolvedValue
                  const displayExecution = displayExecutionRef.current
                  const outputIteration = getCompletedOutputIteration(
                    displayExecution.nodeStatuses[mapping.sourceNodeId] ??
                      'idle',
                    displayExecution.nodeRunCounts[mapping.sourceNodeId] ?? 0,
                  )
                  if (outputIteration !== null) {
                    nextSourceIterations[inputKey] = outputIteration
                  }
                }
              }
            }
          } catch (error) {
            console.error(
              `Failed to resolve ${mapping.sourcePath} from ${mapping.sourceNodeId}:`,
              error,
            )
            hasResolutionError = true
          }
        }
      }

      if (cancelled) return
      setResolution({
        runId: hasMappedCapabilityInputs ? currentRunId : null,
        data: nextData,
        sourceIterations: nextSourceIterations,
      })
      if (hasResolutionError) {
        setLocalVisualizationStatus('failed', hasPendingCapabilityInputs)
      } else if (Object.keys(nextData).length > 0) {
        setLocalVisualizationStatus('resolved', hasPendingCapabilityInputs)
      }
    }

    void resolveValues()
    return () => {
      cancelled = true
    }
  }, [
    campaignNodes,
    parentCodeNodeConnectionsRef,
    mappings,
    mappedParentCompletionSignature,
    mappedSourceExecutionSignature,
    executionState.campaignStatus,
    currentRunId,
    id,
    mappedInputCount,
    hasMappedCapabilityInputs,
    completedMappedSourceNodeIds,
    setNodeStatus,
    resolveJsonFileNodeValue,
    resolveJsonTextNodeValue,
  ])

  const data = getVisibleResolvedVisualizationData(resolution, currentRunId)
  const sourceIterations = getVisibleResolvedVisualizationData(
    { runId: resolution.runId, data: resolution.sourceIterations },
    currentRunId,
  )
  return { data, sourceIterations }
}
