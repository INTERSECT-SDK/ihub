/**
 * Materializes campaign execution inputs by resolving mapped frontend-owned
 * source nodes into target manual values while preserving JSON-safe data.
 */
import type {
  CampaignGraphData,
  CampaignModel,
  CampaignNode,
  CampaignTask,
  CapabilityEndpointChannel,
} from '@ihub/utils/types/campaign'
import { variableTypesAreCompatible } from '@ihub/utils/helpers/variableTypes'

// Node's focused TypeScript test runner requires the imported file extension.
// @ts-expect-error TypeScript extensions are valid here because this package is no-emit.
import { getLogicalCampaignTaskEdgeEndpoints } from '../graph/connections.ts'
// @ts-expect-error TypeScript extensions are valid here because this package is no-emit.
import { getCapabilityPayloadVariables } from '../schema/capabilitySchema.ts'

export type CodeNodeValueResolver = (
  sourceNode: CampaignNode,
  sourceParameter: string,
) => Promise<unknown>

export type JsonFileNodeValue = {
  value: unknown
  runtimeType: string
}

export type JsonFileNodeValueResolver = (
  sourceNode: CampaignNode,
  sourceParameter: string,
) => Promise<JsonFileNodeValue>

export type CampaignValueResolvers = {
  resolveCodeNodeValue: CodeNodeValueResolver
  resolveJsonFileNodeValue?: JsonFileNodeValueResolver
}

export type CampaignMappingDetails = {
  sourceNodeId: string
  sourceParameter: string
  targetNodeId: string
  targetParameter: string
}

/** User-safe failure raised while resolving one execution-time mapping. */
export class CampaignMaterializationError extends Error {
  readonly mapping: CampaignMappingDetails

  /**
   * Creates a user-safe materialization failure for a specific edge mapping.
   *
   * @param mapping - Source and target endpoints involved in the failed mapping.
   * @param reason - Short user-safe explanation of why resolution failed.
   */
  constructor(mapping: CampaignMappingDetails, reason: string) {
    super(
      `Could not resolve ${mapping.sourceNodeId}.${mapping.sourceParameter} ` +
        `for ${mapping.targetNodeId}.${mapping.targetParameter}: ${reason}`,
    )
    this.name = 'CampaignMaterializationError'
    this.mapping = mapping
  }
}

/**
 * Produces a deep JSON-safe clone of a resolved kernel value.
 *
 * @param value - Live value returned by the code-node resolver.
 * @param mapping - Mapping context used when reporting serialization errors.
 * @returns A JSON-compatible copy that can be stored in campaign data.
 * @throws CampaignMaterializationError when the value is undefined or cannot
 * be represented as JSON.
 */
function cloneJsonValue(
  value: unknown,
  mapping: CampaignMappingDetails,
): unknown {
  if (value === undefined) {
    throw new CampaignMaterializationError(
      mapping,
      'the resolved value is undefined',
    )
  }

  try {
    const serialized = JSON.stringify(value)
    if (serialized === undefined) {
      throw new Error('value has no JSON representation')
    }
    return JSON.parse(serialized) as unknown
  } catch {
    throw new CampaignMaterializationError(
      mapping,
      'the resolved value is not JSON-serializable',
    )
  }
}

/**
 * Writes a value into a nested manual-input object using a dot-delimited path.
 *
 * @param manualValues - Mutable manual-input object for the target node.
 * @param targetParameter - Dot-delimited path to update.
 * @param value - JSON-safe value to assign at the target path.
 * @param mapping - Mapping context used when reporting invalid target paths.
 * @throws CampaignMaterializationError when the target path is empty or unsafe.
 */
function setNestedManualValue(
  manualValues: Record<string, unknown>,
  targetParameter: string,
  value: unknown,
  mapping: CampaignMappingDetails,
): void {
  const path = targetParameter.split('.')
  if (
    path.length === 0 ||
    path.some(
      (segment) =>
        !segment ||
        segment === '__proto__' ||
        segment === 'prototype' ||
        segment === 'constructor',
    )
  ) {
    throw new CampaignMaterializationError(
      mapping,
      'the target path is invalid',
    )
  }

  let cursor = manualValues
  for (const segment of path.slice(0, -1)) {
    const existing = cursor[segment]
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
      cursor[segment] = {}
    }
    cursor = cursor[segment] as Record<string, unknown>
  }

  cursor[path[path.length - 1]!] = value
}

/**
 * Converts existing flattened manual-input keys under the same root into nested
 * objects before writing a mapped value.
 *
 * @param manualValues - Mutable manual-input object for the target node.
 * @param targetParameter - Dot-delimited target path being materialized.
 * @param mapping - Mapping context used for nested path validation errors.
 */
function foldFlattenedManualValues(
  manualValues: Record<string, unknown>,
  targetParameter: string,
  mapping: CampaignMappingDetails,
): void {
  const [root, ...targetPath] = targetParameter.split('.')
  if (!root || targetPath.length === 0) {
    return
  }

  const flattenedPrefix = `${root}.`
  for (const key of Object.keys(manualValues)) {
    if (!key.startsWith(flattenedPrefix)) {
      continue
    }

    const value = manualValues[key]
    setNestedManualValue(manualValues, key, value, mapping)
    delete manualValues[key]
  }
}

/**
 * Determines the logical source and target nodes for a campaign edge.
 *
 * @param edge - Campaign edge whose React Flow handles may encode direction.
 * @returns Logical source and target node IDs, or null when the edge does not
 * represent a supported data-flow direction.
 */
function getLogicalEdgeEndpoints(edge: CampaignGraphData['edges'][number]): {
  sourceNodeId: string
  targetNodeId: string
} | null {
  const isHandleless = edge.sourceHandle == null && edge.targetHandle == null
  const isCanonicalHorizontal =
    edge.sourceHandle === 'output-right' && edge.targetHandle === 'input-left'
  const isReverseHorizontal =
    edge.sourceHandle === 'input-left' && edge.targetHandle === 'output-right'
  if (!isHandleless && !isCanonicalHorizontal && !isReverseHorizontal) {
    return null
  }

  const { source, target } = getLogicalCampaignTaskEdgeEndpoints(edge)
  return { sourceNodeId: source, targetNodeId: target }
}

/**
 * Clones a campaign and injects live code-node and JSON-file values into
 * capability inputs. Other mappings and graph structure remain unchanged.
 *
 * @param campaignData - Campaign graph and node data to materialize.
 * @param resolvers - Async readers for frontend-owned source node values.
 * @returns A cloned campaign with mapped capability inputs updated.
 * @throws CampaignMaterializationError when a mapped value or path cannot be
 * materialized safely.
 */
export async function materializeCampaignValues(
  campaignData: CampaignGraphData,
  resolvers: CampaignValueResolvers,
): Promise<CampaignGraphData> {
  const materializedCampaign = structuredClone(campaignData)
  const sourceNodes = new Map(campaignData.nodes.map((node) => [node.id, node]))
  const targetNodes = new Map(
    materializedCampaign.nodes.map((node) => [node.id, node]),
  )

  for (const edge of campaignData.edges) {
    const mappings = edge.data?.data_mapping ?? []
    if (mappings.length === 0) {
      continue
    }

    const endpoints = getLogicalEdgeEndpoints(edge)
    if (!endpoints) {
      continue
    }

    const { sourceNodeId, targetNodeId } = endpoints
    const sourceNode = sourceNodes.get(sourceNodeId)
    const targetNode = targetNodes.get(targetNodeId)
    const firstMapping = mappings[0]!
    const missingNodeMapping: CampaignMappingDetails = {
      sourceNodeId,
      sourceParameter: firstMapping.source_parameter,
      targetNodeId,
      targetParameter: firstMapping.target_parameter,
    }

    if (!sourceNode) {
      throw new CampaignMaterializationError(
        missingNodeMapping,
        'the source node is missing',
      )
    }
    if (!targetNode) {
      throw new CampaignMaterializationError(
        missingNodeMapping,
        'the target node is missing',
      )
    }
    if (
      (sourceNode.type !== 'code' &&
        sourceNode.type !== 'json-file' &&
        sourceNode.type !== 'json-text') ||
      targetNode.type !== 'capability'
    ) {
      continue
    }

    const manualInputValues = structuredClone(
      (targetNode.data.manualInputValues as
        | Record<string, unknown>
        | undefined) ?? {},
    )

    for (const mapping of mappings) {
      const details: CampaignMappingDetails = {
        sourceNodeId: sourceNode.id,
        sourceParameter: mapping.source_parameter,
        targetNodeId: targetNode.id,
        targetParameter: mapping.target_parameter,
      }

      let resolvedValue: unknown
      try {
        if (sourceNode.type === 'code') {
          resolvedValue = await resolvers.resolveCodeNodeValue(
            sourceNode,
            mapping.source_parameter,
          )
        } else {
          if (!resolvers.resolveJsonFileNodeValue) {
            throw new CampaignMaterializationError(
              details,
              'the JSON file resolver is unavailable',
            )
          }
          const resolvedJsonValue = await resolvers.resolveJsonFileNodeValue(
            sourceNode,
            mapping.source_parameter,
          )
          const targetData = targetNode.data as {
            capability?: CampaignTask['capability_metadata']
            endpoint_channel: CapabilityEndpointChannel
          }
          const targetInput = getCapabilityPayloadVariables(
            targetData.endpoint_channel?.subscribe?.message?.payload ?? {},
            targetData.capability,
          ).find((input) => input.path === mapping.target_parameter)
          if (!targetInput?.type) {
            throw new CampaignMaterializationError(
              details,
              'the target input schema could not be resolved',
            )
          }
          if (
            !variableTypesAreCompatible(
              resolvedJsonValue.runtimeType,
              targetInput.type,
            )
          ) {
            throw new CampaignMaterializationError(
              details,
              `the JSON value type changed to ${resolvedJsonValue.runtimeType}, which is incompatible with ${targetInput.type}`,
            )
          }
          resolvedValue = resolvedJsonValue.value
        }
      } catch (error) {
        if (error instanceof CampaignMaterializationError) {
          throw error
        }
        throw new CampaignMaterializationError(
          details,
          sourceNode.type !== 'code'
            ? error instanceof Error
              ? error.message
              : 'the live JSON value could not be fetched'
            : 'the live kernel value could not be fetched',
        )
      }

      foldFlattenedManualValues(
        manualInputValues,
        mapping.target_parameter,
        details,
      )
      setNestedManualValue(
        manualInputValues,
        mapping.target_parameter,
        cloneJsonValue(resolvedValue, details),
        details,
      )
    }

    targetNode.data.manualInputValues = manualInputValues
  }

  return materializedCampaign
}

function isJsonFileModelTask(task: CampaignTask): boolean {
  return task.hierarchy === 'json-file' && task.json_file_data != null
}

function isJsonTextModelTask(task: CampaignTask): boolean {
  return task.hierarchy === 'json-text' && task.json_text_data != null
}

function isJsonSourceModelTask(task: CampaignTask): boolean {
  return isJsonFileModelTask(task) || isJsonTextModelTask(task)
}

function isCodeModelTask(task: CampaignTask): boolean {
  return task.hierarchy === 'code' || task.capability === 'Code'
}

/**
 * Resolves code and JSON mappings in a cloned CampaignModel while preserving
 * its complete authored graph. Only mapped target manual-input values change.
 */
export async function materializeCampaignModelValues(
  campaignModel: CampaignModel,
  resolvers: CampaignValueResolvers,
): Promise<CampaignModel> {
  const materializedModel = structuredClone(campaignModel)

  for (const taskGroup of materializedModel.task_groups) {
    const sourceTaskIds = new Set(
      taskGroup.tasks
        .filter(
          (task) =>
            (isCodeModelTask(task) && task.code_data != null) ||
            isJsonSourceModelTask(task),
        )
        .map((task) => task.id),
    )
    const graphNodes = taskGroup.tasks.flatMap<CampaignNode>((task) => {
      if (isCodeModelTask(task) && task.code_data) {
        return [
          {
            id: task.id,
            type: 'code' as const,
            position: task.ui_position ?? { x: 0, y: 0 },
            data: task.code_data,
          } as CampaignNode,
        ]
      }

      if (isJsonFileModelTask(task)) {
        return [
          {
            id: task.id,
            type: 'json-file' as const,
            position: task.ui_position ?? { x: 0, y: 0 },
            data: task.json_file_data!,
          } as CampaignNode,
        ]
      }

      if (isJsonTextModelTask(task)) {
        return [
          {
            id: task.id,
            type: 'json-text' as const,
            position: task.ui_position ?? { x: 0, y: 0 },
            data: task.json_text_data!,
          } as CampaignNode,
        ]
      }

      if (
        task.hierarchy === 'visualization' ||
        task.capability === 'Visualization' ||
        task.hierarchy === 'renderer' ||
        task.capability === 'Renderer'
      ) {
        return []
      }

      return [
        {
          id: task.id,
          type: 'capability' as const,
          position: task.ui_position ?? { x: 0, y: 0 },
          data: {
            capability: task.capability_metadata,
            endpoint: task.operation_id ?? task.event_name ?? 'endpoint',
            endpoint_channel: task.endpoint_channel,
            manualInputValues: task.manual_input_values,
          },
        } as CampaignNode,
      ]
    })
    const graphNodeIds = new Set(graphNodes.map((node) => node.id))
    const graph: CampaignGraphData = {
      campaignId: materializedModel.id,
      campaignName: materializedModel.name,
      createdAt: '',
      updatedAt: '',
      nodes: graphNodes,
      edges: (taskGroup.ui_edges ?? [])
        .filter(
          (edge) =>
            graphNodeIds.has(edge.source) && graphNodeIds.has(edge.target),
        )
        .map((edge, index) => ({
          id: `model-edge-${edge.source}-${edge.target}-${index}`,
          ...edge,
        })),
    }

    const materializedGraph =
      sourceTaskIds.size > 0
        ? await materializeCampaignValues(graph, resolvers)
        : graph
    const materializedNodes = new Map(
      materializedGraph.nodes.map((node) => [node.id, node]),
    )
    const mappedTargetIds = new Set(
      graph.edges.flatMap((edge) => {
        if ((edge.data?.data_mapping?.length ?? 0) === 0) {
          return []
        }
        const endpoints = getLogicalEdgeEndpoints(edge)
        return endpoints && sourceTaskIds.has(endpoints.sourceNodeId)
          ? [endpoints.targetNodeId]
          : []
      }),
    )

    for (const task of taskGroup.tasks) {
      if (!mappedTargetIds.has(task.id)) {
        continue
      }
      const materializedNode = materializedNodes.get(task.id)
      const manualInputValues = materializedNode?.data.manualInputValues
      if (manualInputValues === undefined) {
        continue
      }
      task.manual_input_values = structuredClone(manualInputValues)
    }
  }

  return materializedModel
}

/** Preserves the original code-only API for existing callers and tests. */
export function materializeCodeNodeValues(
  campaignData: CampaignGraphData,
  resolveValue: CodeNodeValueResolver,
): Promise<CampaignGraphData> {
  return materializeCampaignValues(campaignData, {
    resolveCodeNodeValue: resolveValue,
  })
}
