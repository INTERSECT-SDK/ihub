import type { CampaignModel } from '@ihub/utils/types/campaign'

import type { CampaignDocumentSession } from './types'
// Node's focused TypeScript test runner requires the sibling file extension.
// @ts-expect-error TypeScript extensions are valid here because this package is no-emit.
import { classifyCampaignDocument } from './classify.ts'
// Node's focused TypeScript test runner requires the sibling file extension.
// @ts-expect-error TypeScript extensions are valid here because this package is no-emit.
import { createCanonicalDocumentSession } from './canonicalAdapter.ts'
/** Creates a canonical editor session or rejects a non-canonical document. */
export function createCampaignDocumentSession(
  document: unknown,
): CampaignDocumentSession {
  classifyCampaignDocument(document)
  return createCanonicalDocumentSession(document as CampaignModel)
}
