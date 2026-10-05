import type { CampaignStatus, NodeStatus } from '../../state/executionContext'

export type VisualizationResolutionPhase =
  | 'idle'
  | 'resolving'
  | 'resolved'
  | 'failed'

export type VisualizationStatusInput = {
  currentRunId: string | null
  mappedInputCount: number
  phase: VisualizationResolutionPhase
  hasPendingCapabilityInputs?: boolean
}

/**
 * Maps local visualization data-resolution state to a node badge status.
 *
 * @param input - Current run identity, mapping count, and resolution phase.
 * @returns A status to write, or `null` when no visualization status applies.
 */
export function getVisualizationNodeStatus({
  currentRunId,
  mappedInputCount,
  phase,
  hasPendingCapabilityInputs = false,
}: VisualizationStatusInput): NodeStatus | null {
  if (
    !currentRunId ||
    mappedInputCount === 0 ||
    phase === 'idle' ||
    hasPendingCapabilityInputs
  ) {
    return null
  }

  if (phase === 'resolving') {
    return 'executing'
  }

  if (phase === 'resolved') {
    return 'complete'
  }

  return 'error'
}

/**
 * Maps visualization resolution state to the status written to execution state.
 *
 * @param input - Current run identity, mapping count, and resolution phase.
 * @returns The active visualization status, or `idle` to clear stale badges.
 */
export function getVisualizationNodeStatusUpdate(
  input: VisualizationStatusInput,
): NodeStatus {
  return getVisualizationNodeStatus(input) ?? 'idle'
}

/**
 * Controls whether a local visualization refresh should surface as an
 * executing badge.
 *
 * @param campaignStatus - Current overall campaign execution status.
 * @returns Whether resolving visualization data should write an executing badge.
 */
export function shouldShowVisualizationResolvingStatus(
  campaignStatus: CampaignStatus,
): boolean {
  return campaignStatus === 'executing'
}
