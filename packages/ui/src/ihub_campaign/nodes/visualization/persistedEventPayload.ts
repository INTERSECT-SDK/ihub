import type { CapabilityEventDefinition } from '@ihub/utils/types/campaign'

// Node's focused TypeScript test runner requires the sibling file extension.
// @ts-expect-error TypeScript extensions are valid here because this package is no-emit.
import { getEventRootOutputName } from '../event/eventSchema.ts'

/** Resolves one mapped value from a persisted Event task payload. */
export function resolvePersistedEventPayloadValue(
  serializedPayload: string,
  sourcePath: string,
  eventDefinition: CapabilityEventDefinition | undefined,
  schemaDocument: Record<string, unknown> = {},
): unknown {
  const payload: unknown = JSON.parse(serializedPayload)
  const rootOutputName = getEventRootOutputName(eventDefinition, schemaDocument)

  if (rootOutputName !== null) {
    const isObjectValue =
      payload !== null && typeof payload === 'object' && !Array.isArray(payload)
    return sourcePath === rootOutputName && !isObjectValue ? payload : undefined
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return undefined
  }

  return (payload as Record<string, unknown>)[sourcePath]
}
