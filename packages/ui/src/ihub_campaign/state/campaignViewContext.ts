import { createContext, useContext } from 'react'

export type CampaignViewScope = {
  provenanceKey: string
  readOnly: boolean
}

export type CampaignViewSettings = CampaignViewScope & {
  canMutate: (scheduledProvenanceKey?: string) => boolean
}

/**
 * Creates a guard that evaluates work against the latest campaign view scope.
 * Delayed work supplies the provenance it originated from so it cannot mutate
 * a newer campaign or historical view.
 */
export function createCampaignViewMutationGuard(
  getLatestScope: () => CampaignViewScope,
): CampaignViewSettings['canMutate'] {
  return (scheduledProvenanceKey) => {
    const latestScope = getLatestScope()
    return (
      !latestScope.readOnly &&
      (scheduledProvenanceKey === undefined ||
        scheduledProvenanceKey === latestScope.provenanceKey)
    )
  }
}

/** Supplies provenance and mutation policy to every campaign graph descendant. */
export const CampaignViewContext = createContext<
  CampaignViewSettings | undefined
>(undefined)

/** Reads the provenance and editability of the campaign graph being shown. */
export function useCampaignView(): CampaignViewSettings {
  const context = useContext(CampaignViewContext)

  if (!context) {
    throw new Error(
      'useCampaignView must be used within CampaignViewContext.Provider',
    )
  }

  return context
}
