import type { CampaignModel } from '@ihub/utils/types/campaign'

/** Canonical campaign state accepted by the editor boundary. */
export interface CampaignDocumentSession {
  model: CampaignModel
}

/** Stable error categories exposed by campaign document adapters. */
export type CampaignDocumentAdapterErrorCode =
  | 'ambiguous-document'
  | 'invalid-canonical-document'
  | 'legacy-document'
  | 'non-serializable-document'
  | 'unsupported-document'
