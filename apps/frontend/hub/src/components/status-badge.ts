export const STATUS_BADGE_COLORS = {
  healthy: 'green',
  warning: 'yellow',
  error: 'red',
  neutral: 'gray',
} as const

/**
 * Maps connection and availability states to the shared badge palette.
 */
export function getStatusBadgeColor(status: string): string {
  switch (status) {
    case 'connected':
    case 'online':
    case 'available':
    case 'ACTIVE':
    case 'COMPLETED':
      return STATUS_BADGE_COLORS.healthy
    case 'stale':
    case 'warning':
      return STATUS_BADGE_COLORS.warning
    case 'offline':
    case 'error':
    case 'disconnected':
    case 'failed':
    case 'ABORTED':
      return STATUS_BADGE_COLORS.error
    case 'connecting':
    case 'interrupted':
    case 'unavailable':
    default:
      return STATUS_BADGE_COLORS.neutral
  }
}
