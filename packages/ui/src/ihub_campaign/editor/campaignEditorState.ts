import type { CampaignModelTab } from '../model/selectors'

export const masterCampaignSheetId = 'master-campaign'

/** Keeps a selected sheet only while it exists in the replacement model. */
export function resolveCampaignSheetId(
  tabs: CampaignModelTab[],
  selectedSheetId: string = masterCampaignSheetId,
): string {
  return tabs.some((tab) => tab.id === selectedSheetId)
    ? selectedSheetId
    : masterCampaignSheetId
}
