import type { CampaignModel } from '@ihub/utils/types/campaign'

import type { CampaignDocumentSession } from './types'
// Node's focused TypeScript test runner requires the sibling file extension.
// @ts-expect-error TypeScript extensions are valid here because this package is no-emit.
import * as campaignDocumentClassifier from './classify.ts'

const { CampaignDocumentAdapterError, classifyCampaignDocument } =
  campaignDocumentClassifier

function cloneSerializableModel(model: CampaignModel): CampaignModel {
  try {
    const serialized = JSON.stringify(model)
    if (serialized === undefined) {
      throw new TypeError('CampaignModel did not produce a JSON value.')
    }
    return JSON.parse(serialized) as CampaignModel
  } catch (error) {
    throw new CampaignDocumentAdapterError(
      'non-serializable-document',
      `CampaignModel must contain only serializable data: ${
        error instanceof Error ? error.message : 'serialization failed'
      }`,
    )
  }
}

/** Creates an immutable identity-adapter session for a CampaignModel document. */
export function createCanonicalDocumentSession(
  document: unknown,
): CampaignDocumentSession {
  classifyCampaignDocument(document)

  const model = cloneSerializableModel(document as CampaignModel)
  return {
    model,
  }
}
