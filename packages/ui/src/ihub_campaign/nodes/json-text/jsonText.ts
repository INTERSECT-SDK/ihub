import type { JsonTextNode } from '@ihub/utils/types/campaign'
import type { JsonFileNodeValueResolver } from '../../execution/materialization'
import { inferJsonValueType, resolveJsonPointer } from '../json-file/jsonFile'

/**
 * Parses raw JSON text typed into a JSON Text node.
 *
 * @param textContent - Raw text entered by the user.
 * @returns The parsed JSON value.
 * @throws Error When the text is empty or not valid JSON.
 */
export function parseJsonTextContent(textContent: string | undefined): unknown {
  if (!textContent || !textContent.trim()) {
    throw new Error('no JSON text has been entered')
  }
  try {
    return JSON.parse(textContent)
  } catch {
    throw new Error('the entered text is not valid JSON')
  }
}

/**
 * Creates a resolver that reads mapped values from JSON-text campaign nodes.
 *
 * @returns Async resolver for mapped node parameter values.
 */
export function createJsonTextNodeValueResolver(): JsonFileNodeValueResolver {
  return async (sourceNode, sourceParameter) => {
    const nodeData = sourceNode.data as JsonTextNode
    const manifestField = nodeData.manifest?.find(
      (field) => field.pointer === sourceParameter,
    )
    if (!manifestField || manifestField.type === null) {
      throw new Error('the mapped JSON field is not available in the manifest')
    }

    const value = resolveJsonPointer(
      parseJsonTextContent(nodeData.textContent),
      sourceParameter,
    )
    const runtimeType = inferJsonValueType(value)
    if (!runtimeType) {
      throw new Error('the mapped JSON value has an unresolved runtime type')
    }
    return { value, runtimeType }
  }
}
