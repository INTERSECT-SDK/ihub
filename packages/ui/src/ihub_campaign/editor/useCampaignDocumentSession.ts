import type { CampaignModel } from '@ihub/utils/types/campaign'
import { useMemo } from 'react'

import {
  CampaignDocumentAdapterError,
  createCampaignDocumentSession,
  type CampaignDocumentSession,
} from '../document'
import { validateCampaignModelReferences } from '../model/validation'

type CampaignDocumentSessionResult =
  | { session: CampaignDocumentSession }
  | { error: unknown }

/** Classifies, validates, and synchronizes an external campaign document. */
export function useCampaignDocumentSession(
  document: CampaignModel,
): CampaignDocumentSessionResult {
  return useMemo(() => {
    try {
      const session = createCampaignDocumentSession(document)
      const [issue] = validateCampaignModelReferences(session.model)
      if (issue) {
        throw new CampaignDocumentAdapterError(
          'invalid-canonical-document',
          `Campaign reference validation failed at ${issue.path}: ${issue.message}`,
        )
      }
      return { session }
    } catch (error) {
      return { error }
    }
  }, [document])
}
