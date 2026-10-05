import { Avatar, Card, Grid } from '@mantine/core'
import { useState, useEffect } from 'react'
import { CapabilityHeader, SortDropdown } from './ViewCommonComponents'
import classes from './style.module.css'
import { useRouter } from 'next/navigation'
import { StoreProfile } from '@/types'
import useSWR from 'swr'

export default function DisplayCapabilityStore() {
  const [sortBy, setSortBy] = useState<string | null>(null)
  const [profiles, setProfiles] = useState<StoreProfile[]>([])

  /* fetch brokers from database */
  const { data } = useSWR('/profiles', async (url: string) => {
    const response = await fetch(url)
    const files = await response.json()
    return files as StoreProfile[]
  })

  useEffect(() => {
    if (data) {
      if (sortBy) {
        const sortedProfiles = data.sort((a, b) =>
          a[sortBy] > b[sortBy] ? 1 : -1,
        )
        setProfiles(sortedProfiles)
      } else {
        setProfiles(data)
      }
    }
  }, [data, sortBy])

  return (
    <>
      <SortDropdown options={['name']} setSortBy={setSortBy} />

      {profiles.map((profile) => (
        <StoreItem
          key={`server_type_broker_${profile.name}`}
          capability={profile}
        />
      ))}
    </>
  )
}

/**
 * helper component for each server
 */
function StoreItem({ capability }) {
  const router = useRouter()

  return (
    <Card
      className={classes.capabilityItem}
      variant='outline'
      py={'auto'}
      px={'md'}
      // onClick={() => router.push(`/hub/profile/${capability.fileName}`)}
    >
      <Grid align='center' gutter='lg'>
        <Grid.Col span={2} mr={10}>
          <Avatar radius={'sm'} src={capability.headerImageURL} />
        </Grid.Col>
        <Grid.Col span='auto'>
          <CapabilityHeader
            label={capability.name}
            shortDescription={capability.shortDescription}
          />
        </Grid.Col>
      </Grid>
    </Card>
  )
}
