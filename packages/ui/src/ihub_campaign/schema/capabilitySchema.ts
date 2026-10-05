import { getVariablesFromNode } from '@ihub/utils/helpers/helpers'
import type { Capability } from '@ihub/utils/types/campaign'
import type { VariableItem } from '@ihub/utils/types/types'

function isSchemaRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function decodeJsonPointerSegment(segment: string): string | undefined {
  if (/~(?:[^01]|$)/.test(segment)) return undefined
  return segment.replaceAll('~1', '/').replaceAll('~0', '~')
}

function resolveLocalSchemaReference(
  reference: string,
  schemaDocument: Record<string, unknown>,
): unknown {
  if (reference === '#') return schemaDocument
  if (!reference.startsWith('#/')) return undefined

  let current: unknown = schemaDocument
  for (const encodedSegment of reference.slice(2).split('/')) {
    const segment = decodeJsonPointerSegment(encodedSegment)
    if (segment === undefined) return undefined

    if (isSchemaRecord(current)) {
      if (!Object.hasOwn(current, segment)) return undefined
      current = current[segment]
    } else if (Array.isArray(current)) {
      if (!/^\d+$/.test(segment)) return undefined
      const index = Number(segment)
      if (!Number.isSafeInteger(index) || index >= current.length) {
        return undefined
      }
      current = current[index]
    } else {
      return undefined
    }
  }
  return current
}

function resolveSchemaValue(
  value: unknown,
  schemaDocument: Record<string, unknown>,
  activeReferences: ReadonlySet<string>,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) =>
      resolveSchemaValue(item, schemaDocument, activeReferences),
    )
  }
  if (!isSchemaRecord(value)) return value

  const reference = typeof value.$ref === 'string' ? value.$ref : null
  if (reference && !activeReferences.has(reference)) {
    const referencedSchema = resolveLocalSchemaReference(
      reference,
      schemaDocument,
    )
    if (referencedSchema !== undefined) {
      const nextActiveReferences = new Set(activeReferences)
      nextActiveReferences.add(reference)
      const resolvedReference = resolveSchemaValue(
        referencedSchema,
        schemaDocument,
        nextActiveReferences,
      )
      const resolvedSiblings = Object.fromEntries(
        Object.entries(value)
          .filter(([key]) => key !== '$ref')
          .map(([key, item]) => [
            key,
            resolveSchemaValue(item, schemaDocument, activeReferences),
          ]),
      )

      if (isSchemaRecord(resolvedReference)) {
        return { ...resolvedReference, ...resolvedSiblings }
      }
    }
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      resolveSchemaValue(item, schemaDocument, activeReferences),
    ]),
  )
}

/** Returns a cycle-safe copy with supported local JSON Schema references resolved. */
export function resolveJsonSchemaReferences(
  schema: unknown,
  schemaDocument: Record<string, unknown> = {},
): unknown {
  return resolveSchemaValue(schema, schemaDocument, new Set())
}

/** Returns the complete schema document stored with capability metadata. */
export function getCapabilitySchemaDocument(
  capability: Pick<Capability, 'endpoints_schema'> | undefined,
): Record<string, unknown> {
  return capability?.endpoints_schema ?? {}
}

/** Resolves a capability payload before deriving editor-visible variables. */
export function getCapabilityPayloadVariables(
  payload: unknown,
  capability: Pick<Capability, 'endpoints_schema'> | undefined,
): VariableItem[] {
  const resolvedPayload = resolveJsonSchemaReferences(
    payload ?? {},
    getCapabilitySchemaDocument(capability),
  )
  if (
    isSchemaRecord(resolvedPayload) &&
    typeof resolvedPayload.$ref === 'string'
  ) {
    return []
  }

  return getVariablesFromNode(resolvedPayload)
}
