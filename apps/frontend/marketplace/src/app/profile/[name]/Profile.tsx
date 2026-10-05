'use client'

import {
  Badge,
  Box,
  Button,
  Divider,
  Flex,
  Grid,
  Image,
  Notification,
  Text,
  Title,
} from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { useState } from 'react'

interface StoreProfile {
  project: string
  name: string
  shortDescription: string
  longDescription: string
  division: string
  directorate: string
  contact: string
  contribrutors: string[]
  repository: string
  brokerIPAddress: string
  brokerPort: string
  brokerProtocol: string
  published: string
  lastUpdated: string
  headerImageURL: string
}

interface ProfileProps {
  profile: StoreProfile
}

export default function Profile({ profile }: ProfileProps) {
  const [installNotification, setInstallNotfication] = useState('')

  const [installing, { toggle: toggleInstalling, close: closeInstalling }] =
    useDisclosure()
  const [showInstalledAlert, { toggle: toggleInstalledAlert }] = useDisclosure()

  // const [availableCapabilities, setAvailableCapabilities] = useAtom(
  //   availableCapabilitiesAtom,
  // )

  const {
    project,
    name,
    shortDescription,
    longDescription,
    division,
    directorate,
    contact,
    contribrutors,
    repository,
    brokerIPAddress,
    brokerPort,
    brokerProtocol,
    published,
    lastUpdated,
    headerImageURL,
  } = profile

  function installCapability() {
    toggleInstalling()
    setInstallNotfication(`${name} has been added to your subscriptions.`)

    // let installedCapabilitiesGroup = availableCapabilities.find(
    //   (cap) => cap.groupName === 'Browse installed capabilities',
    // )
    let installedCapabilitiesGroup = null

    /* Add group if missing */
    if (!installedCapabilitiesGroup) {
      installedCapabilitiesGroup = {
        groupName: 'Browse installed capabilities',
        capabilities: [],
      } // ref to availableCapabilities
    }

    /* Fake installation time */
    setTimeout(() => {
      toggleInstalledAlert()
      closeInstalling()
    }, 3000)
  }

  return (
    <Box p={50} w='100%'>
      <Grid align='center'>
        <Grid.Col span={3}>
          <Flex justify='center'>
            <Image radius='md' src={headerImageURL} alt={name} />
          </Flex>
        </Grid.Col>
        <Grid.Col span={9}>
          <Title order={1}>{name}</Title>
          <Text fw={500}>{shortDescription}</Text>
          <Text>
            {division}, {directorate}
          </Text>
          <Button
            mt='md'
            size='sm'
            radius='xl'
            loading={installing}
            onClick={installCapability}
          >
            Subscribe to Broker
          </Button>
          {showInstalledAlert && (
            <Notification
              color='green'
              title='Capability Added!'
              mt='md'
              onClose={() => toggleInstalledAlert()}
              w='60%'
            >
              {installNotification}
            </Notification>
          )}
        </Grid.Col>
      </Grid>
      <Divider my='md' />
      <Grid>
        <Grid.Col span={7}>
          <Title order={2}>{name}</Title>
        </Grid.Col>
        <Grid.Col span={5}>
          <Title order={5} mt='sm'>
            Information
          </Title>
        </Grid.Col>

        <Grid.Col span={7}>
          <Divider mb='md' />
          <Text>{longDescription}</Text>
        </Grid.Col>
        <Grid.Col span={2}>
          <Text fw={500}>Project:</Text>
          <Text fw={500}>Contact:</Text>
          <Text fw={500}>Contributers:</Text>
          <Text fw={500}>Repository:</Text>
          <Text fw={500}>Broker IP:</Text>
          <Text fw={500}>Broker Port:</Text>
          <Text fw={500}>Broker Protocol:</Text>
          <Text fw={500}>Published:</Text>
          <Text fw={500}>Last Updated:</Text>
        </Grid.Col>
        <Grid.Col span={3}>
          <Text>{project}</Text>
          <Text>{contact}</Text>
          <Badge size='md' color='gray'>
            {contribrutors.length}
          </Badge>
          <Text>{repository}</Text>
          <Text>{brokerIPAddress}</Text>
          <Text>{brokerPort}</Text>
          <Text>{brokerProtocol}</Text>
          <Text>{published}</Text>
          <Text>{lastUpdated}</Text>
        </Grid.Col>
      </Grid>
    </Box>
  )
}
