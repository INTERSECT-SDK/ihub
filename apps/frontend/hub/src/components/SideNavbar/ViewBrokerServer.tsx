'use client'

import {
  Accordion,
  AccordionControl,
  AccordionItem,
  AccordionPanel,
  Button,
  Code,
  Divider,
  Flex,
  Group,
  Modal,
  Text,
} from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { useCallback, useState, useEffect, ReactElement } from 'react'
import {
  AddConnectionButton,
  EditConnection,
  ServerHeader,
  SortDropdown,
} from './ViewCommonComponents.tsx'
import {
  Broker,
  Capability,
  LifecycleMessage,
  Service,
} from '@ihub/utils/types/campaign'
import useSWR, { useSWRConfig } from 'swr'
import { IHubIconEdit, IHubIconTrash } from '@ihub/utils/icons'
import { FieldDef } from '@ihub/utils/types/types'
import { useAtomValue } from 'jotai'
import { selectedProjectIdAtom } from '@/atoms/global.ts'
import { shouldAutoConnectBroker } from './broker-auto-connect.ts'
import { isBrokerListCacheKey } from './broker-list-cache-key.ts'
import {
  deriveOrchestratorHealthStatus,
  getOrchestratorHealthKey,
  ORCHESTRATOR_HEALTH_REFRESH_INTERVAL,
  parseOrchestratorHealthResponse,
  scheduleOrchestratorHealthRetry,
} from './orchestrator-health.ts'
import { summarizeIntersectServerStatus } from './intersect-server-status.ts'

interface DisplayBrokerServerStatusProps {
  brokers: Broker[]
  icon?: ReactElement
}

/**
 * Component to show brokers and related information in Mantine accordians.
 */
export default function DisplayBrokerServerStatus({
  brokers,
  icon,
}: DisplayBrokerServerStatusProps) {
  const [sortBy, setSortBy] = useState<string | null>(null)
  const [isError, setIsError] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [isSuccess, setIsSuccess] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')
  const [editId, setEditId] = useState<number | null>(null)

  const [addNewConnection, setAddNewConnection] = useState<boolean>(false)
  const selectedProjectId = useAtomValue(selectedProjectIdAtom)
  const brokersUrl = selectedProjectId
    ? `/api/v1/brokers?project_id=${selectedProjectId}`
    : '/api/v1/brokers'

  /* Use to manual trigger fetch */
  const { mutate } = useSWRConfig()

  /* Control loader when connecting to a broker */
  const [connecting, { open: openConn, close: closeConn }] = useDisclosure()

  const [openedDelModal, { open: openDelModal, close: closeDelModal }] =
    useDisclosure(false)

  /* Renders each state change, improve? */
  let sortedBrokers = brokers
  if (sortBy) {
    sortedBrokers = sortedBrokers.sort((a: Broker, b: Broker) =>
      a[sortBy] > b[sortBy] ? 1 : -1,
    )
  }

  /**
   * Adds new Broker.
   */
  function addBroker() {
    setAddNewConnection(!addNewConnection)
  }

  /**
   * Edit the broker profile in a tab. If the profile is already open,
   * that tab becomes active. Otherwise, a new tab is opened.
   * @param broker Broker server object.
   */
  function handleEditClick(broker: Broker) {
    setEditId(broker.id as number)
  }

  /**
   * Send a request to connect to a broker.
   * @param broker Broker server object.
   */
  const connectHandler = useCallback(
    async function (broker: Broker, silent = false) {
      console.log(`[AUTO-CONNECT] Attempting to connect broker ${broker.label}`)

      if (broker?.status === 'connected') {
        if (!silent) {
          setIsError(true)
          setErrorMsg('broker is already connected.')
        }
        return
      }
      openConn() // start button loader
      const response = await fetch(`/api/v1/brokers/connect/${broker.id}`, {
        method: 'PATCH',
        headers: {
          'Content-type': 'application/json',
        },
      })
      closeConn() // end button loader

      if (response.ok) {
        if (!silent) {
          setIsSuccess(true)
          setSuccessMsg('broker connected')
        }
      } else {
        if (!silent) {
          setIsError(true)
          setErrorMsg('unable to connect broker')
        }
      }

      /* Refresh every broker-list view, including the campaign's unscoped list. */
      await mutate(isBrokerListCacheKey)
    },
    [closeConn, mutate, openConn],
  )

  useEffect(() => {
    async function autoConnectBrokers() {
      for (const broker of brokers) {
        if (shouldAutoConnectBroker(broker)) {
          await connectHandler(broker, true) // true = silent
        }
      }
    }

    autoConnectBrokers()
  }, [brokers, connectHandler])

  /**
   * Send a request to disconnect a broker.
   * @param broker Broker server object.
   */
  async function disconnectHandler(broker: Broker) {
    if (broker?.status === 'connected') {
      const response = await fetch(`/api/v1/brokers/disconnect/${broker.id}`, {
        method: 'DELETE',
        headers: {
          'Content-type': 'application/json',
        },
      })

      if (response.ok) {
        setIsSuccess(true)
        setSuccessMsg('broker disconnected')
      } else {
        setIsError(true)
        const res_json = await response.json()
        setErrorMsg(res_json.detail)
      }
    } else {
      setIsError(true)
      setErrorMsg('broker is already disconnected')
    }

    /* Refresh every broker-list view, including the campaign's unscoped list. */
    await mutate(isBrokerListCacheKey)
  }

  /**
   * Reset all notifications.
   */
  function resetNotifications() {
    setIsError(false)
    setErrorMsg('')
    setIsSuccess(false)
    setSuccessMsg('')
  }

  /**
   * Send a request to delete a broker.
   * @param broker Broker server object.
   */
  async function submitDelete(brokerID: number) {
    const response = await fetch(`/api/v1/brokers/${brokerID}`, {
      method: 'DELETE',
    })
    console.log(response)

    if (!response.ok) {
      setIsError(true)
      setErrorMsg('Error: Broker Not Deleted')
    } else {
      mutate(brokersUrl)
      setIsSuccess(true)
      setSuccessMsg('Broker Deleted Successfully')
    }
  }

  const defaultBrokerFields: FieldDef[] = [
    {
      name: 'label',
      label: 'Name',
      type: 'text',
      placeholder: 'Enter a label for the broker',
      required: true,
    },
    {
      name: 'hostIP',
      label: 'IP Address',
      type: 'text',
      placeholder: 'Enter the broker server IP address',
      required: true,
    },
    {
      name: 'port',
      label: 'Port',
      type: 'text',
      placeholder: 'Enter the broker server port number',
      required: true,
    },
    {
      name: 'protocol',
      label: 'Message Protocol',
      type: 'select',
      options: ['amqp0.9.1', 'mqtt5.0'],
      placeholder: 'amqp or mqtt',
      required: true,
    },
    {
      name: 'username',
      label: 'Username',
      type: 'text',
      placeholder: 'Enter broker server username',
      required: true,
    },
    {
      name: 'password',
      label: 'Password',
      type: 'password',
      placeholder: 'Enter broker server password',
      required: false,
    },
    {
      name: 'orchestratorUrl',
      label: 'Orchestrator URL',
      type: 'text',
      placeholder: 'Enter orchestrator URL (optional)',
      required: false,
    },
    {
      name: 'orchestratorApiKey',
      label: 'Orchestrator API Key',
      type: 'text',
      placeholder: 'Enter orchestrator API key (optional)',
      required: false,
    },
  ]

  return (
    <>
      <AddConnectionButton
        serverType={'INTERSECT'}
        handleClick={addBroker}
        fields={defaultBrokerFields}
        expand={addNewConnection}
        url={'/api/v1/brokers'}
        buttonLabel='Create new INTERSECT broker'
        formTitle='Create new INTERSECT broker'
      />
      <SortDropdown options={['status', 'name']} setSortBy={setSortBy} />

      <Accordion mx={'sm'} variant='separated' radius={'md'}>
        {sortedBrokers.map((server: Broker) => (
          <div key={`broker-${server.id}`}>
            <AccordionItem
              key={`broker-${server.id}`}
              value={`broker-${server.id}`}
            >
              <AccordionControl
                icon={icon}
                onClick={() => resetNotifications()}
              >
                <BrokerServerItem server={server} />
              </AccordionControl>
              <AccordionPanel>
                {server.status === 'connected' ? (
                  <Button
                    variant='light'
                    size='xs'
                    my={'md'}
                    fullWidth
                    radius={'xl'}
                    color='var(--mantine-color-gray-8)'
                    onClick={async () => await disconnectHandler(server)}
                  >
                    Disconnect
                  </Button>
                ) : (
                  <Button
                    color='var(--mantine-color-blue-8)'
                    size='xs'
                    radius={'xl'}
                    my={'md'}
                    fullWidth
                    onClick={async () => await connectHandler(server)}
                    loading={connecting}
                  >
                    Connect
                  </Button>
                )}
                {/* ------------------------------- Broker Actions ----------------------- */}
                <Group gap='sm' grow>
                  <Button
                    color='var(--mantine-color-red-6)'
                    onClick={() => submitDelete(server.id as number)}
                    leftSection={<IHubIconTrash size={16} />}
                    size='xs'
                    variant='light'
                    radius={'xl'}
                  >
                    Delete
                  </Button>
                  <Button
                    size='xs'
                    radius={'xl'}
                    variant='light'
                    color='var(--mantine-color-gray-8)'
                    leftSection={<IHubIconEdit size={16} />}
                    onClick={() => handleEditClick(server)}
                  >
                    Edit
                  </Button>
                </Group>
              </AccordionPanel>
              {editId && editId === (server.id as number) && (
                <AccordionPanel>
                  <EditConnection
                    serverType={'INTERSECT'}
                    handleClick={() => setEditId(null)}
                    fields={defaultBrokerFields}
                    url={'/api/v1/brokers/' + server.id}
                    currentValues={server}
                    onSuccess={() => mutate(brokersUrl)}
                  />
                </AccordionPanel>
              )}
              <AccordionPanel>
                <BrokerServicesInfo brokerID={server.id as number} />
              </AccordionPanel>
            </AccordionItem>
          </div>
        ))}
      </Accordion>
    </>
  )
}

/* ------------------------------ Helper Components --------------------- */

/**
 * Props for BrokerServicesItem component.
 */
interface BrokerServicesItemProps {
  server: Broker
}

/**
 * Component to display server information about the Broker.
 * @param server Broker server object.
 */
function BrokerServerItem({ server }: BrokerServicesItemProps) {
  const healthKey = getOrchestratorHealthKey(server.id, server.orchestratorUrl)
  const { data: orchestratorStatus, error: orchestratorError } = useSWR(
    healthKey,
    async ([healthEndpoint]: readonly [string, string]) => {
      const response = await fetch(healthEndpoint)
      if (!response.ok) {
        throw new Error('Unable to check orchestrator health')
      }

      const status = parseOrchestratorHealthResponse(await response.json())
      if (!status) {
        throw new Error('Invalid orchestrator health response')
      }
      return status
    },
    {
      refreshInterval: ORCHESTRATOR_HEALTH_REFRESH_INTERVAL,
      revalidateOnFocus: true,
      revalidateOnMount: true,
      shouldRetryOnError: true,
      onErrorRetry: (_error, _key, _config, revalidate, revalidateOptions) => {
        scheduleOrchestratorHealthRetry(revalidate, revalidateOptions)
      },
    },
  )
  const displayedOrchestratorStatus = deriveOrchestratorHealthStatus({
    orchestratorUrl: server.orchestratorUrl,
    status: orchestratorStatus,
    failed: Boolean(orchestratorError),
  })
  const serverStatus = summarizeIntersectServerStatus(
    server.status ?? 'unavailable',
    displayedOrchestratorStatus,
  )

  return (
    <>
      <ServerHeader
        url={`${server.hostIP}:${server.port}`}
        label={server.label}
        status={serverStatus.status}
        statusTooltip={serverStatus.tooltip}
      />
    </>
  )
}

/**
 * Props for BrokerServicesInfo component.
 */
interface BrokerServicesInfoProps {
  brokerID: number
}

/**
 * Component to fetch and display broker services, capabilites and endpoints.
 * @param brokerID ID of broker in the database.
 */
function BrokerServicesInfo({ brokerID }: BrokerServicesInfoProps) {
  const { data: services } = useSWR(
    `/api/v1/services/${brokerID}`,
    async (url: string) => {
      const response = await fetch(url)
      if (response.ok) {
        const data = await response.json()
        return data as Service[]
      } else {
        return [] as Service[]
      }
    },
    { revalidateIfStale: true },
  )

  return (
    <>
      {/* <Divider my='sm' label='Summary' />
      <Text>Services ({messages ? getAllServices(messages).length : 0})</Text>
      <Text>
        Capabilites ({messages ? getAllCapabilites(messages).length : 0})
      </Text>
      <Text>Endpoints ({messages ? getAllEndpoints(messages).length : 0})</Text> */}

      {services && services.length > 0 ? (
        <Divider my='sm' label={`Services (${services.length})`} />
      ) : (
        <Divider my='sm' label={`No services available`} />
      )}

      {services && <ServicesList services={services} />}
    </>
  )
}

/**
 * Props for ServiceList component.
 */
interface ServiceListProps {
  services: Service[] | undefined
}

/**
 * Component to display a list of services found in broker lifecycle messages.
 * @param services Array of service objects from the database.

 */
function ServicesList({ services }: ServiceListProps) {
  return (
    <Accordion multiple={true}>
      {services?.map((service) => (
        <AccordionItem
          key={`${service.name}-capability-list`}
          value={service.name}
        >
          <AccordionControl>
            <Text size='sm'>
              {service.name.toUpperCase().replaceAll('-', ' ')}
            </Text>
          </AccordionControl>
          <AccordionPanel px={0}>
            <CapabilityEndpoints service={service} />
          </AccordionPanel>
        </AccordionItem>
      ))}
    </Accordion>
  )
}

/**
 * Props for CapabilityEndpoints component.
 */
interface CapabilityEndpointsProps {
  service: Service
}

/**
 * Component to display a list of capabilities for each service found in broker lifecycle messages.
 * @param serviceName Name of the INTERSECT service.
 * @param messages Array of parsed lifecycle messages from the database.
 */
function CapabilityEndpoints({ service }: CapabilityEndpointsProps) {
  const { data: capabilities } = useSWR(
    `/api/v1/capabilities/${service.id}`,
    async (url: string) => {
      const response = await fetch(url)
      if (response.ok) {
        const data = await response.json()
        return data as Capability[]
      } else {
        return [] as Capability[]
      }
    },
    { revalidateIfStale: true },
  )

  return (
    <Accordion>
      {capabilities?.map((capability) => (
        <AccordionItem
          mr={0}
          pr={0}
          bd={'none'}
          key={`${capability.name}-endpoints-list`}
          value={`${service.name}_${capability.name}-endpoints-list`}
        >
          <AccordionControl mr={0} pr={0}>
            <Text size='sm'>{capability.name}</Text>
          </AccordionControl>
          <AccordionPanel mr={0} pr={0}>
            <EndpointsList capability={capability} />
          </AccordionPanel>
        </AccordionItem>
      ))}
    </Accordion>
  )
}

/**
 * Props for EndpointsList component.
 */
interface EndpointsListProps {
  capability: Capability
}

/**
 * Component to display a list of endpoint for each capability found in broker lifecycle messages.
 * @param capabilityName Name of the INTERSECT capability within a service.
 * @param messages Array of parsed lifecycle messages from the database.
 */
function EndpointsList({ capability }: EndpointsListProps) {
  const endpoints = Object.keys(capability.endpoints_schema.endpoints || {})

  return (
    <Accordion
      key={`${capability.name}-endpoints-list`}
      mx={'sm'}
      variant='separated'
      radius={'md'}
      multiple
    >
      {endpoints.map((endpoint, idx) => (
        <AccordionItem
          mr={0}
          pr={0}
          bd={'none'}
          bg={'var(--mantine-color-blue-0)'}
          key={`capability-${capability.name}-endpoint-${idx}`}
          value={`capability-${capability.name}-endpoint-${idx}`}
        >
          <AccordionControl>
            <Code bg={'none'} fw={'bold'} c={'var(--mantine-color-blue-7)'}>
              {endpoint}
            </Code>
          </AccordionControl>

          <AccordionPanel>
            <Text size='xs'>
              {capability.endpoints_schema.endpoints[endpoint].publish
                .description || 'No description available.'}
            </Text>
          </AccordionPanel>
        </AccordionItem>
      ))}
    </Accordion>
  )
}

/* ----------------------------- Helper Functions --------------------------- */

/**
 * Returns all services found in lifecycle messages.
 * @param messages Array of broker lifecycle messages from database.
 */
function getAllServices(messages: LifecycleMessage[]) {
  const serviceNames = new Set(messages.map((msg) => msg.service))
  return Array.from(serviceNames)
}

/**
 * Returns a list of Capabilites for a specific Service.
 * @param serviceName Name of the INTERSECT service.
 * @param messages Array of broker lifecycle messages from database.
 */
function getServiceCapabilites(
  serviceName: string,
  messages: LifecycleMessage[],
) {
  const serviceMsgs = messages.filter((msg) => msg.service === serviceName)
  const capabilityNames = new Set(
    serviceMsgs?.map((msg) => msg.sdk_capability_name),
  )
  return Array.from(capabilityNames) || []
}

/**
 * Returns all capabilites found in lifecycle messages.
 * @param messages Array of broker lifecycle messages from database.
 */
function getAllCapabilites(messages: LifecycleMessage[]) {
  const serviceNames = getAllServices(messages)
  const capabilites = serviceNames.map((name) =>
    getServiceCapabilites(name, messages),
  )
  return capabilites.flat()
}

/**
 * Returns endpoints for a specific capability.
 * @param capabilityName Name of the INTERSECT capability.
 * @param messages Array of broker lifecycle messages from database.
 */
function getCapabilityEndpoints(
  capabilityName: string,
  messages: LifecycleMessage[],
) {
  const serviceMsg = messages.find(
    (msg) => msg.sdk_capability_name === capabilityName,
  )
  const endpointNames = serviceMsg?.endpoint_names.split(',')
  return endpointNames || []
}

/**
 * Returns all endpoints found in lifecycle messages.
 * @param messages Array of broker lifecycle messages from database.
 */
function getAllEndpoints(messages: LifecycleMessage[]) {
  const endpointNames = getAllCapabilites(messages).map((name) =>
    getCapabilityEndpoints(name, messages),
  )
  return endpointNames.flat()
}
