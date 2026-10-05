export type CampaignStartGuard = {
  current: boolean
}

type CampaignStartSingleFlightOptions = {
  guard: CampaignStartGuard
  onStartingChange: (isStarting: boolean) => void
  start: () => Promise<void>
}

/**
 * Runs one campaign-start attempt at a time and always releases its UI guard.
 *
 * @param options - Shared guard, UI state callback, and start operation.
 * @returns True when this call acquired the guard, otherwise false.
 */
export async function runCampaignStartSingleFlight({
  guard,
  onStartingChange,
  start,
}: CampaignStartSingleFlightOptions): Promise<boolean> {
  if (guard.current) {
    return false
  }

  guard.current = true
  onStartingChange(true)

  try {
    await start()
    return true
  } finally {
    guard.current = false
    onStartingChange(false)
  }
}
