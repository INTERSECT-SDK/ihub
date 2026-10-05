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
import { useState, ReactElement } from 'react'
import {
  AddConnectionButton,
  EditConnection,
  ServerHeader,
  SortDropdown,
} from './ViewCommonComponents.tsx'
import useSWR, { useSWRConfig } from 'swr'
import { IHubIconEdit, IHubIconTrash } from '@ihub/utils/icons'
import { MCPServer } from '@ihub/utils/types/campaign'
import { FieldDef } from '@ihub/utils/types/types'
import { useAtomValue } from 'jotai'
import { selectedProjectIdAtom } from '@/atoms/global.ts'

type MCPToolOption = {
  mcp_server_id: number
  tool_name: string
  tool_description?: string
}

interface DisplayMCPServerStatusProps {
  mcp_servers: MCPServer[]
  icon?: ReactElement
}

const defaultMCPServerFields: FieldDef[] = [
  {
    name: 'label',
    label: 'Name',
    type: 'text',
    placeholder: 'Enter a label for the MCP server',
    required: true,
  },
  {
    name: 'url',
    label: 'URL',
    type: 'text',
    placeholder: 'Enter the URL for the MCP server',
    required: true,
  },
  {
    name: 'token',
    label: 'Token',
    type: 'password',
    placeholder: 'Enter the authentication token for the MCP server',
    required: false,
  },
]

/**
 * Component to show MCP servers and related information in Mantine accordians.
 */
export default function DisplayMCPServerStatus({
  mcp_servers,
  icon,
}: DisplayMCPServerStatusProps) {
  const [sortBy, setSortBy] = useState<string | null>(null)
  const [isError, setIsError] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [isSuccess, setIsSuccess] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')

  const [editId, setEditId] = useState<number | null>(null)

  const [addNewConnection, setAddNewConnection] = useState<boolean>(false)
  const selectedProjectId = useAtomValue(selectedProjectIdAtom)
  const mcpServersUrl = selectedProjectId
    ? `/api/v1/mcp_servers?project_id=${selectedProjectId}`
    : '/api/v1/mcp_servers'

  /* Use to manual trigger fetch */
  const { mutate } = useSWRConfig()

  /* Renders each state change, improve? */
  let sortedServers = mcp_servers
  if (sortBy) {
    sortedServers = sortedServers.sort((a: MCPServer, b: MCPServer) =>
      a[sortBy] > b[sortBy] ? 1 : -1,
    )
  }

  /**
   * Adds new MCP Server.
   */
  function addMCPServer() {
    setAddNewConnection(!addNewConnection)
  }

  /**
   * Send a request to delete an MCP server.
   * @param mcpServerId MCP server unique id in the database.
   */
  async function submitDelete(mcpServerId: number) {
    const response = await fetch(`/api/v1/mcp_servers/${mcpServerId}`, {
      method: 'DELETE',
    })
    console.log(response)
    if (!response.ok) {
      setIsError(true)
      setErrorMsg('Error: MCP Server Not Deleted')
    } else {
      mutate(mcpServersUrl)
      setIsSuccess(true)
      setSuccessMsg('MCP Server Deleted Successfully')
    }
  }

  return (
    <>
      <AddConnectionButton
        serverType={'MCP Server'}
        handleClick={addMCPServer}
        fields={defaultMCPServerFields}
        expand={addNewConnection}
        url={'/api/v1/mcp_servers'}
        buttonLabel='Create new MCP server'
        formTitle='Create new MCP server'
      />
      <SortDropdown options={['status', 'name']} setSortBy={setSortBy} />

      <Accordion mx={'sm'} variant='separated' radius={'md'}>
        {sortedServers.map((server: MCPServer) => (
          <div key={`mcp-server-${server.id}`}>
            <AccordionItem
              key={`mcp-server-${server.id}`}
              value={`mcp-server-${server.id}`}
            >
              <AccordionControl icon={icon}>
                <MCPServerItem server={server} />
              </AccordionControl>
              <AccordionPanel>
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
                    onClick={() => setEditId(server.id as number)}
                  >
                    Edit
                  </Button>
                </Group>
              </AccordionPanel>
              {editId && editId === (server.id as number) && (
                <AccordionPanel>
                  <EditConnection
                    serverType={'MCP server'}
                    handleClick={() => setEditId(null)}
                    fields={defaultMCPServerFields}
                    url={'/api/v1/mcp_servers/' + editId}
                    currentValues={server}
                    onSuccess={() => mutate(mcpServersUrl)}
                  />
                </AccordionPanel>
              )}

              <AccordionPanel>
                <MCPServerItemTools server={server} />
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
 * Component to display server information about the MCP server.
 * @param server MCP server object.
 */

interface MCPServerItemProps {
  server: MCPServer
  tools?: MCPToolOption[]
}

function MCPServerItem({ server, tools = [] }: MCPServerItemProps) {
  const { data: fetchedTools } = useSWR(
    `/api/v1/mcp_servers/${server.id}/tools`,
    async (url: string) => {
      const response = await fetch(url)
      if (!response.ok) {
        return [] as MCPToolOption[]
      }
      return (await response.json()) as MCPToolOption[]
    },
  )
  const displayTools = fetchedTools || tools
  const serverStatus =
    tools.length > 0 ? 'connected' : (server.status ?? 'unavailable')

  return (
    <>
      <ServerHeader
        url={`${server.url}`}
        label={server.label}
        status={displayTools.length > 0 ? 'connected' : serverStatus}
      />
    </>
  )
}

function MCPServerItemTools({ server, tools = [] }: MCPServerItemProps) {
  const { data: fetchedTools } = useSWR(
    `/api/v1/mcp_servers/${server.id}/tools`,
    async (url: string) => {
      const response = await fetch(url)
      if (!response.ok) {
        return [] as MCPToolOption[]
      }
      return (await response.json()) as MCPToolOption[]
    },
  )
  const displayTools = fetchedTools || tools
  const hasTools = displayTools.length > 0

  return (
    <>
      {hasTools ? (
        <Divider my='sm' label={`Tools (${displayTools.length})`} />
      ) : (
        <Divider my='sm' label={`No tools available.`} />
      )}

      {hasTools && (
        <Accordion mx={'sm'} variant='separated' radius={'md'} multiple>
          {displayTools.map((tool, idx) => (
            <AccordionItem
              mr={0}
              pr={0}
              bd={'none'}
              bg={'var(--mantine-color-blue-0)'}
              key={`mcp-${server.id}-tool-${idx}`}
              value={`mcp-${server.id}-tool-${idx}`}
            >
              <AccordionControl>
                <Code bg={'none'} fw={'bold'} c={'var(--mantine-color-blue-7)'}>
                  {tool.tool_name}
                </Code>
              </AccordionControl>

              <AccordionPanel>
                <Text size='xs'>
                  {tool.tool_description || 'No description provided.'}
                </Text>
              </AccordionPanel>
            </AccordionItem>
          ))}
        </Accordion>
      )}
    </>
  )
}
