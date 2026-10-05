'use client'

import { Alert, Button, Group, Modal, Stack, Text } from '@mantine/core'
import { formatLocalDateTime } from '@ihub/utils/helpers/date-time'
import type { Broker } from '@ihub/utils/types/campaign'

import type { CampaignRecoveryState, CampaignRun } from '../execution/recovery'

type CampaignRecoveryUiProps = {
  state: CampaignRecoveryState
  brokers: Broker[] | undefined
  selectRun: (run: CampaignRun) => void
  retry: () => void
}

function getBrokerLabel(
  run: CampaignRun,
  brokers: Broker[] | undefined,
): string {
  if (run.broker_id == null) return 'Unknown broker ID'
  const broker = brokers?.find(({ id }) => String(id) === String(run.broker_id))
  return broker
    ? `${broker.label} (ID ${run.broker_id})`
    : `Broker ID ${run.broker_id}`
}

/** Renders the shared recovery chooser and actionable recovery error state. */
export function CampaignRecoveryUi({
  state,
  brokers,
  selectRun,
  retry,
}: CampaignRecoveryUiProps) {
  return (
    <>
      <Modal
        opened={state.phase === 'selection-required'}
        onClose={() => {}}
        title='Choose the active campaign run to restore'
        closeOnClickOutside={false}
        closeOnEscape={false}
        withCloseButton={false}
        centered
      >
        <Stack gap='sm'>
          <Text size='sm'>
            More than one active run matches this campaign. Select the run this
            editor should follow.
          </Text>
          {state.phase === 'selection-required' &&
            state.runs.map((run) => (
              <Button
                key={run.run_id}
                variant='light'
                h='auto'
                py='sm'
                onClick={() => selectRun(run)}
                styles={{ label: { width: '100%' } }}
              >
                <Stack gap={2} align='flex-start' w='100%'>
                  <Text size='sm' fw={600} style={{ wordBreak: 'break-all' }}>
                    {run.run_id}
                  </Text>
                  <Text size='xs'>{getBrokerLabel(run, brokers)}</Text>
                  <Text size='xs'>
                    Started {formatLocalDateTime(run.run_at) ?? 'Unknown'}
                  </Text>
                </Stack>
              </Button>
            ))}
        </Stack>
      </Modal>

      {state.phase === 'error' && (
        <Alert color='red' title='Campaign recovery failed' mx='md' mt='sm'>
          <Stack gap='xs'>
            <Text size='sm'>{state.message}</Text>
            <Group>
              <Button size='xs' variant='light' color='red' onClick={retry}>
                Retry
              </Button>
            </Group>
          </Stack>
        </Alert>
      )}
    </>
  )
}
