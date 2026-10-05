import type { CampaignModel } from '@ihub/utils/types/campaign'

import type { CampaignDocumentAdapterErrorCode } from './types'

type UnknownDocument = Record<string, unknown>

/** Error raised when a persisted campaign cannot safely cross the boundary. */
export class CampaignDocumentAdapterError extends Error {
  readonly code: CampaignDocumentAdapterErrorCode

  constructor(code: CampaignDocumentAdapterErrorCode, message: string) {
    super(message)
    this.name = 'CampaignDocumentAdapterError'
    this.code = code
  }
}

function isObject(value: unknown): value is UnknownDocument {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOwn(document: UnknownDocument, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(document, field)
}

function hasNonEmptyString(document: UnknownDocument, field: string): boolean {
  return typeof document[field] === 'string' && document[field].length > 0
}

/** Classifies and minimally validates a campaign at its document boundary. */
export function classifyCampaignDocument(value: unknown): 'campaign-model' {
  if (!isObject(value)) {
    throw new CampaignDocumentAdapterError(
      'unsupported-document',
      'Campaign documents must be JSON objects.',
    )
  }

  const hasCanonicalMarker = hasOwn(value, 'task_groups')
  const hasLegacyMarker =
    hasOwn(value, 'campaignId') ||
    hasOwn(value, 'nodes') ||
    hasOwn(value, 'edges')

  if (hasCanonicalMarker && hasLegacyMarker) {
    throw new CampaignDocumentAdapterError(
      'ambiguous-document',
      'This campaign mixes retired legacy fields with CampaignModel fields and cannot be opened.',
    )
  }

  if (hasCanonicalMarker) {
    if (
      !Array.isArray(value.task_groups) ||
      !hasNonEmptyString(value, 'id') ||
      !hasNonEmptyString(value, 'run_id')
    ) {
      throw new CampaignDocumentAdapterError(
        'invalid-canonical-document',
        'CampaignModel documents require non-empty id and run_id fields and a task_groups array.',
      )
    }
    return 'campaign-model'
  }

  if (hasLegacyMarker) {
    throw new CampaignDocumentAdapterError(
      'legacy-document',
      'This campaign uses the retired legacy format and cannot be opened. Create a new campaign using the current CampaignModel format.',
    )
  }

  throw new CampaignDocumentAdapterError(
    'unsupported-document',
    'Document is not a recognized CampaignModel campaign.',
  )
}

/** Returns whether a value is a minimally valid CampaignModel document. */
export function isCampaignModelDocument(
  value: unknown,
): value is CampaignModel {
  try {
    return classifyCampaignDocument(value) === 'campaign-model'
  } catch {
    return false
  }
}
