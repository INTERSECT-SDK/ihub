import {
  Accordion,
  AccordionControl,
  AccordionItem,
  AccordionPanel,
  Text,
  UnstyledButton,
} from '@mantine/core'
import { useState } from 'react'
import useSWR from 'swr'
import classes from './style.module.css'
import {
  AddConnectionButton,
  ServerHeader,
  SortDropdown,
} from './ViewCommonComponents.tsx'
import { FieldDef } from '@ihub/utils/types/types'
import { JupyterServerConfig, JupyterSession } from '@ihub/utils/types/notebook'

const fetcher = ([url, token]: [string, string]) => {
  return fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  }).then((res) => res.json())
}

const defaultJupyterServerFields: FieldDef[] = [
  {
    name: 'label',
    label: 'Name',
    type: 'text',
    placeholder: 'Enter a label for the Jupyter server',
    required: true,
  },
  {
    name: 'url',
    label: 'URL',
    type: 'text',
    placeholder: 'Enter the Jupyter server URL',
    required: true,
  },
  {
    name: 'token',
    label: 'Token',
    type: 'password',
    placeholder: 'Enter the Jupyter server authentication token',
    required: false,
  },
]

export default function DisplayJupyterServerStatus({ servers, icon }) {
  const [sortBy, setSortBy] = useState<string | null>(null)
  const [addJupyeterServer, setAddJupyterServer] = useState<boolean>(false)

  let sorted_servers = [...servers]

  if (sortBy !== null) {
    sorted_servers = sorted_servers.sort((a, b) => {
      const aValue = (a[sortBy] ?? '').toString().toLowerCase()
      const bValue = (b[sortBy] ?? '').toString().toLowerCase()
      return aValue.localeCompare(bValue)
    })
  }

  return (
    <>
      <AddConnectionButton
        serverType={'Jupyter server'}
        handleClick={() => setAddJupyterServer(!addJupyeterServer)}
        fields={defaultJupyterServerFields}
        expand={addJupyeterServer}
        url={'/api/v1/jupyter_servers'}
        buttonLabel='Create new Jupyter server'
        formTitle='Create new Jupyter server'
      />

      <SortDropdown options={['label', 'url']} setSortBy={setSortBy} />

      <Accordion mx={'sm'} variant='separated' radius={'md'}>
        {sorted_servers.map((server) => (
          <AccordionItem
            mt={0}
            key={`server_type_${server.id}_${server.url}`}
            value={getServerAccordionValue(server)}
          >
            <AccordionControl icon={icon}>
              <JupyterServerItem server={server} />
            </AccordionControl>
            <AccordionPanel>
              <ListOfJupyterServerKernels server={server} />
            </AccordionPanel>
          </AccordionItem>
        ))}
      </Accordion>
    </>
  )
}

function getServerAccordionValue(server: JupyterServerConfig) {
  return [server.id, server.label, server.url]
    .filter((value) => value !== undefined && value !== null)
    .map((value) => String(value))
    .find((value) => value.trim().length > 0) as string
}

/**
 * helper component for each server
 */

function JupyterServerItem({ server }: { server: JupyterServerConfig }) {
  const { data, error, isLoading } = useSWR(
    [`${server.url}/api/status`, server.token],
    fetcher,
  )

  let status = 'disconnected'
  if (isLoading) {
    status = 'connecting'
  } else if (error) {
    status = 'failed'
  } else if (data) {
    status = 'connected'
  }
  return (
    <>
      <ServerHeader url={server.url} label={server.label} status={status} />
    </>
  )
}

function ListOfJupyterServerKernels({
  server,
}: {
  server: JupyterServerConfig
}) {
  const { data, error, isLoading } = useSWR(
    [`${server.url}/api/sessions`, server.token],
    fetcher,
  )
  return (
    <>
      {isLoading ? <Text>Loading...</Text> : <></>}
      {error ? <Text>ERROR</Text> : <></>}
      {data?.length === 0 ? <Text size='xs'>no kernels available</Text> : <></>}
      {data?.map((session: JupyterSession) => (
        <IndividualSession
          session={session}
          key={`kernel-component${session.id}`}
        />
      ))}
    </>
  )
}

function IndividualSession({ session }: { session: JupyterSession }) {
  return (
    <>
      <UnstyledButton className={classes.item} variant='dark'>
        <Text size='xs' fw={700}>
          {session.name}
        </Text>
        <Text size='xs'>Kernel: {session.kernel.name}</Text>
        <Text size='xs'>Kernel ID: {session.kernel.id}</Text>
        <Text size='xs'>
          Last activity:{' '}
          {Math.round(
            (Date.now() - Date.parse(session.kernel.last_activity)) /
              (1000 * 60),
          )}{' '}
          minutes ago
        </Text>
        <Text size='xs'>Status: {session.kernel.execution_state}</Text>
        <Text size='xs'>
          Number of connections: {session.kernel.connections}
        </Text>
      </UnstyledButton>
    </>
  )
}
