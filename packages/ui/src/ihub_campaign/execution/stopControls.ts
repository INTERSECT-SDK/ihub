type CampaignStopAvailabilityInput = {
  intersectId: string | null
  isExecutingCampaign: boolean
  isStoppingCampaign: boolean
  activeCampaignRunId: string | null
}

export type CampaignStopConfirmationAction = 'cancel' | 'close' | 'confirm'

type CampaignStopConfirmationCallbacks = {
  stop: () => Promise<boolean>
  close: () => void
}

/**
 * Resolves whether the Stop control can target a known active campaign.
 *
 * @param input - Current user, broker, and campaign execution state.
 * @returns True when the Stop control should be enabled.
 */
export function canStopCampaign({
  intersectId,
  isExecutingCampaign,
  isStoppingCampaign,
  activeCampaignRunId,
}: CampaignStopAvailabilityInput): boolean {
  return (
    Boolean(intersectId) &&
    isExecutingCampaign &&
    !isStoppingCampaign &&
    Boolean(activeCampaignRunId)
  )
}

/**
 * Handles one confirmation modal action for the campaign Stop control.
 *
 * @param action - User action from the confirmation modal.
 * @param callbacks - Stop and close callbacks owned by the component.
 * @returns True only when a confirm action successfully stopped the campaign.
 */
export async function handleCampaignStopConfirmationAction(
  action: CampaignStopConfirmationAction,
  callbacks: CampaignStopConfirmationCallbacks,
): Promise<boolean> {
  if (action !== 'confirm') {
    callbacks.close()
    return false
  }

  const stopped = await callbacks.stop()

  if (stopped) {
    callbacks.close()
  }

  return stopped
}
