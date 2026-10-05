import { useState } from 'react'
import { ActionIcon, Group, Menu, Text, Tooltip } from '@mantine/core'
import { IHubIconCheck, IHubIconMore, IHubIconX } from '@ihub/utils/icons'

import {
  cancelNodeAction,
  confirmNodeAction,
  requestNodeAction,
  type NodeActionConfirmationState,
  type NodeActionDescriptor,
} from './nodeActions'

type NodeActionsMenuProps = {
  actions: NodeActionDescriptor[]
}

const tooltipEvents = { hover: true, focus: true, touch: false } as const

/** Renders node actions and requires an explicit confirmation for mutations. */
export function NodeActionsMenu({ actions }: NodeActionsMenuProps) {
  const [opened, setOpened] = useState(false)
  const [confirmingActionId, setConfirmingActionId] =
    useState<NodeActionConfirmationState>(null)
  const confirmingAction = actions.find(
    (action) => action.id === confirmingActionId,
  )
  const confirmation = confirmingAction?.confirmation

  const handleOpenedChange = (nextOpened: boolean) => {
    setOpened(nextOpened)
    if (!nextOpened) {
      setConfirmingActionId(cancelNodeAction())
    }
  }

  return (
    <Menu
      shadow='md'
      opened={opened}
      onChange={handleOpenedChange}
      closeOnItemClick={false}
    >
      <Tooltip label='Node actions' events={tooltipEvents}>
        <Menu.Target>
          <ActionIcon
            variant='subtle'
            color='gray'
            aria-label='Open node actions'
          >
            <IHubIconMore size={16} />
          </ActionIcon>
        </Menu.Target>
      </Tooltip>
      <Menu.Dropdown style={{ whiteSpace: 'nowrap' }}>
        {confirmation ? (
          <Group gap={4} px='xs' wrap='nowrap'>
            <Text size='sm'>{confirmation.prompt}</Text>
            <Tooltip label={confirmation.confirmLabel} events={tooltipEvents}>
              <ActionIcon
                variant='subtle'
                color='red'
                aria-label={confirmation.confirmLabel}
                disabled={confirmingAction?.disabled}
                onClick={() => {
                  setConfirmingActionId(
                    confirmNodeAction(actions, confirmingActionId),
                  )
                  setOpened(false)
                }}
              >
                <IHubIconCheck size={16} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label={confirmation.cancelLabel} events={tooltipEvents}>
              <ActionIcon
                variant='subtle'
                color='gray'
                aria-label={confirmation.cancelLabel}
                onClick={() => setConfirmingActionId(cancelNodeAction())}
              >
                <IHubIconX size={16} />
              </ActionIcon>
            </Tooltip>
          </Group>
        ) : (
          actions.map((action) => {
            const menuItem = (
              <Menu.Item
                aria-label={action.label}
                leftSection={action.icon}
                disabled={action.disabled}
                onClick={() => {
                  const nextConfirmation = requestNodeAction(action)
                  setConfirmingActionId(nextConfirmation)
                  if (!nextConfirmation) {
                    setOpened(false)
                  }
                }}
              >
                {action.label}
              </Menu.Item>
            )

            return (
              <Tooltip
                key={action.id}
                label={action.tooltip}
                events={tooltipEvents}
              >
                {action.disabled ? <div>{menuItem}</div> : menuItem}
              </Tooltip>
            )
          })
        )}
      </Menu.Dropdown>
    </Menu>
  )
}
