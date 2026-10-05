import { Badge } from '@mantine/core'
import type { NodeStatus } from '../../state/executionContext'

interface NodeStatusBadgeProps {
  status: NodeStatus
  runCount?: number
}

type VisibleNodeStatus = Exclude<NodeStatus, 'idle'>

const statusConfig: Record<
  VisibleNodeStatus,
  { label: string; color: string }
> = {
  waiting: { label: 'Waiting', color: 'gray' },
  executing: { label: 'Executing', color: 'yellow' },
  complete: { label: 'Complete', color: 'green' },
  error: { label: 'Error', color: 'red' },
  aborted: { label: 'Aborted', color: 'red' },
}

export default function NodeStatusBadge({
  status,
  runCount = 0,
}: NodeStatusBadgeProps) {
  if (status === 'idle') {
    return null
  }

  const config = statusConfig[status]
  const runLabel = runCount > 0 ? ` · Run ${runCount}` : ''
  return (
    <Badge h={20} size='xs' me='sm' color={config.color}>
      {config.label}
      {runLabel}
    </Badge>
  )
}
