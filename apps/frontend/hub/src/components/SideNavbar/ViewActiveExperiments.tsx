'use client'

import { type ReactNode, useState } from 'react'

import { formatLocalDateTime } from '@ihub/utils/helpers/date-time'
import {
  Alert,
  Badge,
  Card,
  CloseButton,
  Stack,
  Text,
  TextInput,
} from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import useSWR from 'swr'

import {
  fetchActiveExperimentRuns,
  getBrokerLabel,
  getCampaignRunStatusPresentation,
  type BrokerLabelRecord,
  type TrackedCampaignRun,
} from './active-experiments.ts'

function formatTimestamp(value: string | null) {
  if (!value) {
    return null
  }

  return formatLocalDateTime(value, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

async function fetchBrokerLabels(url: string): Promise<BrokerLabelRecord[]> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Broker request failed with HTTP ${response.status}`)
  }

  const payload: unknown = await response.json()
  if (!Array.isArray(payload)) {
    return []
  }

  return payload.filter((broker): broker is BrokerLabelRecord =>
    Boolean(
      broker &&
      typeof broker === 'object' &&
      (typeof broker.id === 'number' || typeof broker.id === 'string') &&
      typeof broker.label === 'string',
    ),
  )
}

function CampaignRunCard({
  run,
  brokerLabel,
}: {
  run: TrackedCampaignRun
  brokerLabel: string
}) {
  const status = getCampaignRunStatusPresentation(run.status)
  const endedAt = formatTimestamp(run.ended_at)

  return (
    <Card withBorder radius='md' shadow='xs' padding='sm'>
      <Text fw={600} size='sm' lineClamp={2}>
        {run.campaign_name || run.campaign_id}
      </Text>
      <div>
        <Badge color={status.color} size='xs' variant='light'>
          {status.label}
        </Badge>
      </div>
      <Text size='xs' c='dimmed' style={{ overflowWrap: 'anywhere' }} mt='xs'>
        Run ID: {run.run_id}
      </Text>
      <Text size='xs' c='dimmed'>
        Broker: {brokerLabel}
      </Text>
      <Text size='xs' c='dimmed'>
        Started {formatTimestamp(run.run_at)}
      </Text>
      {endedAt && (
        <Text size='xs' c='dimmed'>
          Ended {endedAt}
        </Text>
      )}
    </Card>
  )
}

/** Renders persisted campaign runs for the Active Experiments side panel. */
export default function DisplayActiveExperiments() {
  const [search, setSearch] = useState('')
  const [debouncedSearch] = useDebouncedValue(search, 300)
  const normalizedSearch = debouncedSearch.trim()
  const { data, error, isLoading } = useSWR<TrackedCampaignRun[]>(
    ['active-experiment-runs', normalizedSearch],
    () => fetchActiveExperimentRuns(normalizedSearch),
    {
      refreshInterval: 5000,
      revalidateOnFocus: true,
    },
  )
  const {
    data: brokers,
    error: brokerError,
    isLoading: isLoadingBrokers,
  } = useSWR<BrokerLabelRecord[]>('/api/v1/brokers', fetchBrokerLabels, {
    revalidateOnFocus: true,
  })

  let content: ReactNode
  if (isLoading || isLoadingBrokers) {
    content = (
      <Text size='sm' c='dimmed' p='md'>
        Loading campaign runs...
      </Text>
    )
  } else if (error || brokerError) {
    content = (
      <Alert color='red' m='sm' title='Unable to load active experiments'>
        Active Experiments will retry automatically.
      </Alert>
    )
  } else if (!data?.length) {
    content = (
      <Text size='sm' c='dimmed' p='md'>
        {normalizedSearch
          ? `No experiments match “${normalizedSearch}”.`
          : 'No active or recent campaign runs.'}
      </Text>
    )
  } else {
    content = data.map((run) => (
      <CampaignRunCard
        key={run.run_id}
        run={run}
        brokerLabel={getBrokerLabel(brokers || [], run.broker_id)}
      />
    ))
  }

  return (
    <Stack gap='sm' p='sm'>
      <TextInput
        aria-label='Search experiments by name or run ID'
        placeholder='Search experiments by name or run ID'
        value={search}
        onChange={(event) => setSearch(event.currentTarget.value)}
        rightSection={
          search ? (
            <CloseButton
              aria-label='Clear experiment search'
              size='sm'
              onClick={() => setSearch('')}
            />
          ) : null
        }
        rightSectionPointerEvents={search ? 'auto' : 'none'}
      />
      {content}
    </Stack>
  )
}
