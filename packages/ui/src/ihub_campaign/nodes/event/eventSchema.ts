import type {
  CampaignEventMode,
  Capability,
  CapabilityEventDefinition,
} from '@ihub/utils/types/campaign'

// Node's focused TypeScript test runner requires the imported file extension.
// @ts-expect-error TypeScript extensions are valid here because this package is no-emit.
import * as capabilitySchema from '../../schema/capabilitySchema.ts'

function isSchemaRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function unwrapEventPayloadSchema(
  definition: CapabilityEventDefinition | undefined,
): Record<string, unknown> {
  if (!definition) return {}

  return isSchemaRecord(definition.payload) ? definition.payload : definition
}

function resolveEventPayloadSchema(
  definition: CapabilityEventDefinition | undefined,
  schemaDocument: Record<string, unknown>,
): Record<string, unknown> {
  const resolved = capabilitySchema.resolveJsonSchemaReferences(
    unwrapEventPayloadSchema(definition),
    schemaDocument,
  )
  return isSchemaRecord(resolved) ? resolved : {}
}

/** Returns the complete schema document stored with capability metadata. */
export function getCapabilityEventSchemaDocument(
  capability: Pick<Capability, 'endpoints_schema'> | undefined,
): Record<string, unknown> {
  return capabilitySchema.getCapabilitySchemaDocument(capability)
}

function selectEventPayloadSchema(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  const variants =
    Array.isArray(schema.anyOf) && schema.anyOf.length > 0
      ? schema.anyOf
      : Array.isArray(schema.oneOf)
        ? schema.oneOf
        : null
  if (!variants) return schema

  const selectedVariant = variants.find(
    (variant) => isSchemaRecord(variant) && variant.type !== 'null',
  )
  return isSchemaRecord(selectedVariant)
    ? selectEventPayloadSchema(selectedVariant)
    : {}
}

function isObjectPayloadSchema(schema: Record<string, unknown>): boolean {
  return schema.type === 'object' || isSchemaRecord(schema.properties)
}

function isRootValueSchema(schema: Record<string, unknown>): boolean {
  return (
    Object.hasOwn(schema, 'enum') ||
    Object.hasOwn(schema, 'const') ||
    (typeof schema.type === 'string' && schema.type !== 'null')
  )
}

/** Returns the variable used for a root scalar or array event payload. */
export function getEventRootOutputName(
  definition: CapabilityEventDefinition | undefined,
  schemaDocument: Record<string, unknown> = {},
): string | null {
  const schema = selectEventPayloadSchema(
    resolveEventPayloadSchema(definition, schemaDocument),
  )
  if (
    Object.keys(schema).length === 0 ||
    schema.type === 'null' ||
    isObjectPayloadSchema(schema) ||
    !isRootValueSchema(schema)
  ) {
    return null
  }

  return typeof schema.title === 'string' && schema.title
    ? schema.title
    : 'value'
}

/** Returns the canonical object schema used for editor-visible event outputs. */
export function normalizeEventPayloadSchema(
  definition: CapabilityEventDefinition | undefined,
  schemaDocument: Record<string, unknown> = {},
): Record<string, unknown> {
  const schema = selectEventPayloadSchema(
    resolveEventPayloadSchema(definition, schemaDocument),
  )
  if (Object.keys(schema).length === 0 || schema.type === 'null') return {}
  if (isObjectPayloadSchema(schema)) return schema

  const outputName = getEventRootOutputName(schema, schemaDocument)
  return outputName
    ? { type: 'object', properties: { [outputName]: schema } }
    : {}
}

/** Normalizes editor event settings into the orchestrator task contract. */
export function normalizeEventSettings(
  mode: CampaignEventMode,
  count: number | null | undefined,
): { event_mode: CampaignEventMode; event_count: number | null } {
  if (mode !== 'count') {
    return { event_mode: mode, event_count: null }
  }

  const normalizedCount =
    typeof count === 'number' && Number.isInteger(count) && count > 0
      ? count
      : 1
  return { event_mode: mode, event_count: normalizedCount }
}
