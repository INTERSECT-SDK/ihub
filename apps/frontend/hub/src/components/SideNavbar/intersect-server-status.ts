export type IntersectServerSummaryStatus =
  | 'connected'
  | 'disconnected'
  | 'warning'

export type IntersectServerStatusSummary = {
  status: IntersectServerSummaryStatus
  tooltip?: string
}

function formatStatus(status: string) {
  return status.replaceAll('_', ' ').toUpperCase()
}

/**
 * Summarizes broker and orchestrator health without changing either source
 * state. Mixed, transitional, and indeterminate states produce a warning that
 * identifies only the components that are not connected.
 */
export function summarizeIntersectServerStatus(
  brokerStatus: string,
  orchestratorStatus: string,
): IntersectServerStatusSummary {
  if (brokerStatus === 'connected' && orchestratorStatus === 'connected') {
    return { status: 'connected' }
  }

  if (
    brokerStatus === 'disconnected' &&
    orchestratorStatus === 'disconnected'
  ) {
    return { status: 'disconnected' }
  }

  const warningDetails = [
    ['Broker', brokerStatus],
    ['Orchestrator', orchestratorStatus],
  ]
    .filter(([, status]) => status !== 'connected')
    .map(([component, status]) => `${component}: ${formatStatus(status)}`)

  return {
    status: 'warning',
    tooltip: warningDetails.join(', '),
  }
}
