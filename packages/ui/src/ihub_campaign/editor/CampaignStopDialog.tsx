'use client'

import { Button, Group, Modal, Text } from '@mantine/core'
import { useCallback } from 'react'

import { handleCampaignStopConfirmationAction } from '../execution/stopControls'

type CampaignStopDialogProps = {
  opened: boolean
  isStoppingCampaign: boolean
  stop: () => Promise<boolean>
  close: () => void
}

/** Renders the stop confirmation flow with shared close/cancel/confirm rules. */
export function CampaignStopDialog({
  opened,
  isStoppingCampaign,
  stop,
  close,
}: CampaignStopDialogProps) {
  const handleAction = useCallback(
    (action: 'close' | 'cancel' | 'confirm') => {
      void handleCampaignStopConfirmationAction(action, { stop, close })
    },
    [close, stop],
  )

  return (
    <Modal
      opened={opened}
      onClose={() => handleAction('close')}
      title='Stop campaign?'
      centered
    >
      <Text size='sm'>
        The active campaign will be stopped on the selected INTERSECT server.
      </Text>
      <Group justify='flex-end' mt='md'>
        <Button
          variant='subtle'
          onClick={() => handleAction('cancel')}
          disabled={isStoppingCampaign}
        >
          Cancel
        </Button>
        <Button
          color='red'
          onClick={() => handleAction('confirm')}
          loading={isStoppingCampaign}
        >
          Stop
        </Button>
      </Group>
    </Modal>
  )
}
