import type { ReactNode } from 'react'

export type NodeActionConfirmation = {
  prompt: string
  confirmLabel: string
  cancelLabel: string
  onConfirm: () => void
}

export type NodeActionDescriptor = {
  id: string
  label: string
  tooltip: string
  icon: ReactNode
  disabled?: boolean
  onSelect?: () => void
  confirmation?: NodeActionConfirmation
}

export type NodeActionConfirmationState = string | null

/** Selects an action, entering confirmation without applying its mutation. */
export function requestNodeAction(
  action: NodeActionDescriptor,
): NodeActionConfirmationState {
  if (action.disabled) {
    return null
  }

  if (action.confirmation) {
    return action.id
  }

  action.onSelect?.()
  return null
}

/** Abandons a pending action without applying its mutation. */
export function cancelNodeAction(): NodeActionConfirmationState {
  return null
}

/** Applies the pending action once and clears its confirmation state. */
export function confirmNodeAction(
  actions: NodeActionDescriptor[],
  confirmingActionId: NodeActionConfirmationState,
): NodeActionConfirmationState {
  const action = actions.find((action) => action.id === confirmingActionId)
  if (!action?.disabled) {
    action?.confirmation?.onConfirm()
  }
  return null
}
