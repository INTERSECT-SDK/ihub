import type {
  Capability,
  CapabilityEndpointChannel,
  EventNode,
  JsonFileNode,
  JsonTextNode,
} from '@ihub/utils/types/campaign'
import type { VariableItem } from '@ihub/utils/types/types'
import { getVariablesFromNode } from '@ihub/utils/helpers/helpers'

// Node's focused TypeScript test runner requires the imported file extension.
// @ts-expect-error TypeScript extensions are valid here because this package is no-emit.
import { getCapabilityPayloadVariables } from '../../schema/capabilitySchema.ts'

// Node's focused TypeScript test runner requires the sibling file extension.
// @ts-expect-error TypeScript extensions are valid here because this package is no-emit.
import * as eventSchema from '../event/eventSchema.ts'

type StaticUpstreamNode = {
  id: string
  type?: string
  data: Record<string, unknown>
}

/** Builds selectable outputs for upstream nodes that do not require live I/O. */
export function buildStaticUpstreamOutputItems(
  sourceNodes: StaticUpstreamNode[],
  includeJsonFileSources = true,
): Record<string, VariableItem[]> {
  const parentsOutputs: Record<string, VariableItem[]> = {}

  for (const node of sourceNodes) {
    if (node.type === 'capability') {
      const nodeChannel = node.data
        .endpoint_channel as CapabilityEndpointChannel
      const outputsPayload = nodeChannel?.publish?.message?.payload || {}
      parentsOutputs[node.id] = getCapabilityPayloadVariables(
        outputsPayload,
        node.data.capability as Capability | undefined,
      )
    } else if (node.type === 'event') {
      const eventNode = node.data as EventNode
      parentsOutputs[node.id] = getVariablesFromNode(
        eventSchema.normalizeEventPayloadSchema(
          eventNode.event_schema,
          eventSchema.getCapabilityEventSchemaDocument(eventNode.capability),
        ),
      )
    } else if (node.type === 'json-file' && includeJsonFileSources) {
      const jsonFileNode = node.data as JsonFileNode
      parentsOutputs[node.id] = (jsonFileNode.manifest ?? []).map((field) => ({
        title: field.displayName,
        type: field.type ?? 'unresolved',
        path: field.pointer,
        description: field.unsupportedReason,
      }))
    } else if (node.type === 'json-text' && includeJsonFileSources) {
      const jsonTextNode = node.data as JsonTextNode
      parentsOutputs[node.id] = (jsonTextNode.manifest ?? []).map((field) => ({
        title: field.displayName,
        type: field.type ?? 'unresolved',
        path: field.pointer,
        description: field.unsupportedReason,
      }))
    }
  }

  return parentsOutputs
}
