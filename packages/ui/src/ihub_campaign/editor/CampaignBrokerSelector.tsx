'use client'

import { Select } from '@mantine/core'
import { IHubIconIntersect } from '@ihub/utils/icons'
import type { Broker } from '@ihub/utils/types/campaign'

type CampaignBrokerSelectorProps = {
  brokers: Broker[] | undefined
  intersectId: string | null
  setIntersectId: (intersectId: string | null) => void
  width?: number | string
  disabled?: boolean
}

/** Renders the campaign server selector from the editor's shared broker data. */
export function CampaignBrokerSelector({
  brokers,
  intersectId,
  setIntersectId,
  width = 300,
  disabled = false,
}: CampaignBrokerSelectorProps) {
  return (
    <Select
      className='ms-auto'
      p={0}
      m={0}
      variant='subtle'
      data={brokers?.map((broker) => ({
        value: String(broker.id),
        label: broker.label,
      }))}
      leftSectionPointerEvents='none'
      leftSection={<IHubIconIntersect size={15} stroke={1} />}
      size='xs'
      radius='xl'
      placeholder={
        brokers?.length === 0
          ? 'No INTERSECT instances available'
          : 'Select an INTERSECT instance'
      }
      w={width}
      onChange={setIntersectId}
      value={intersectId ?? undefined}
      disabled={disabled}
    />
  )
}
