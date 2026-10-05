type CampaignRunControlInput = {
  isStartingCampaign: boolean
  isExecutingCampaign: boolean
  intersectId: string | null
  selectedBrokerStatus: string | null | undefined
  hasExecutableCapability: boolean
  recoveryDisabledReason?: string | null
}

export type CampaignStartBrokerState = {
  brokerId: string | null
  status: string | null | undefined
}

/**
 * Preserves a connected broker status across transient refresh gaps while a
 * start attempt is in-flight for the same selected broker.
 */
export function normalizeStartBrokerState(
  previousState: CampaignStartBrokerState,
  nextState: CampaignStartBrokerState,
  isStartingCampaign: boolean,
): CampaignStartBrokerState {
  if (!isStartingCampaign) {
    return nextState
  }

  if (previousState.brokerId !== nextState.brokerId) {
    return nextState
  }

  const isTransientStatusGap =
    nextState.status === undefined || nextState.status === null

  if (isTransientStatusGap && previousState.status === 'connected') {
    return {
      brokerId: nextState.brokerId,
      status: previousState.status,
    }
  }

  return nextState
}

export type CampaignRunControlState = {
  disabled: boolean
  hoverInfo: string
  showTooltipWhenDisabled: boolean
}

/**
 * Returns whether a broker status permits campaign execution.
 *
 * Broker readiness intentionally requires the exact API status value so an
 * unloaded, missing, or differently-cased status cannot start a campaign.
 */
export function isBrokerConnected(
  brokerStatus: string | null | undefined,
): boolean {
  return brokerStatus === 'connected'
}

/**
 * Checks that a campaign start attempt still targets the selected broker.
 *
 * @param startBrokerId - Broker captured when the start attempt began.
 * @param latestBrokerState - Most recently rendered broker selection and status.
 * @returns True when the captured broker remains selected and connected.
 */
export function canContinueCampaignStart(
  startBrokerId: string,
  latestBrokerState: CampaignStartBrokerState,
): boolean {
  return (
    latestBrokerState.brokerId === startBrokerId &&
    isBrokerConnected(latestBrokerState.status)
  )
}

/**
 * Derives the run button state from the campaign execution context.
 *
 * The button is disabled for in-flight start/run operations, missing
 * or disconnected brokers, or campaigns without an executable capability.
 * The returned hover text explains the highest-priority reason to the user.
 */
export function getCampaignRunControlState({
  isStartingCampaign,
  isExecutingCampaign,
  intersectId,
  selectedBrokerStatus,
  hasExecutableCapability,
  recoveryDisabledReason = null,
}: CampaignRunControlInput): CampaignRunControlState {
  const disabled =
    Boolean(recoveryDisabledReason) ||
    isStartingCampaign ||
    isExecutingCampaign ||
    !intersectId ||
    !isBrokerConnected(selectedBrokerStatus) ||
    !hasExecutableCapability

  const hoverInfo = recoveryDisabledReason
    ? recoveryDisabledReason
    : isStartingCampaign
      ? 'Campaign is starting'
      : isExecutingCampaign
        ? 'Campaign is already running'
        : !intersectId
          ? 'Select an INTERSECT server'
          : !isBrokerConnected(selectedBrokerStatus)
            ? 'The selected INTERSECT server must be connected to run this campaign'
            : !hasExecutableCapability
              ? 'Add at least one capability node to run this campaign'
              : 'Run campaign'

  return {
    disabled,
    hoverInfo,
    showTooltipWhenDisabled: disabled,
  }
}
