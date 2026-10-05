'use client'

import {
  Accordion,
  AccordionControl,
  AccordionItem,
  AccordionPanel,
  ActionIcon,
  Anchor,
  Avatar,
  Badge,
  Button,
  Divider,
  Group,
  Menu,
  ScrollArea,
  Text,
  ThemeIcon,
} from '@mantine/core'
import { useState, useEffect, useMemo, ReactElement } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  IconDotsVertical,
  IconPlugConnected,
  IconPlus,
} from '@tabler/icons-react'
import {
  AddConnectionButton,
  EditConnection,
  SortDropdown,
} from './ViewCommonComponents.tsx'
import useSWR, { useSWRConfig } from 'swr'
import { useRef } from 'react'
import { useAtomValue } from 'jotai'
import { selectedProjectIdAtom } from '@/atoms/global.ts'
import {
  IHubIconEdit,
  IHubIconTrash,
  IHubIconAgent,
  IHubIconCopy,
} from '@ihub/utils/icons'
import { Agent } from '@ihub/utils/types/agent'
import { LLMServer } from '@ihub/utils/types/chat'
import { FieldDef } from '@ihub/utils/types/types'
import { getStatusBadgeColor } from '../status-badge.ts'

interface DisplayAgentsProps {
  icon?: ReactElement
}

type RemoteAgent = {
  id: number
  name: string
  url: string
  protocol: RemoteAgentProtocol
  assistant_id: string | null
  auth_token?: string | null
  status: string
  created_at: string
  updated_at: string
}

type RemoteAssistant = {
  id: number
  remote_agent_id: number
  assistant_id: string
  protocol: RemoteAgentProtocol
  graph_id: string | null
  name: string
  description: string | null
  assistant_metadata: Record<string, unknown> | null
  version: number
  status: string
  remote_updated_at: string | null
  last_synced_at: string
  created_at: string
  updated_at: string
}

type RemoteAgentProtocol = 'langgraph' | 'a2a' | 'agui'

type MCPToolOption = {
  id: string
  mcp_server_id: number
  tool_name: string
}

type DisplayAgent =
  | {
      type: 'custom'
      id: string
      name: string
      sortableVisibility: string
      sortableGraphType: string
      data: Agent
    }
  | {
      type: 'remote-assistant'
      id: string
      name: string
      sortableVisibility: string
      sortableGraphType: string
      data: RemoteAssistant
      remoteServerName: string
      remoteServerStatus: string
    }

const customAgentFields: FieldDef[] = [
  {
    name: 'name',
    label: 'Name',
    type: 'text',
    placeholder: 'Enter a name for the agent',
    required: true,
  },
  {
    name: 'description',
    label: 'Description',
    type: 'textarea',
    placeholder: 'Enter a description for the agent',
    required: false,
  },
  {
    name: 'system_prompt',
    label: 'System Prompt',
    type: 'textarea',
    placeholder: 'Enter the system prompt for the agent',
    required: false,
  },
  {
    name: 'graph_type',
    label: 'Agent Type',
    type: 'select',
    options: [
      { label: 'React - Tool-calling agent', value: 'react' },
      { label: 'Supervisor - Multi-agent coordinator', value: 'supervisor' },
    ],
    placeholder: 'Select the graph type',
    defaultValue: 'react',
    required: true,
  },
  {
    name: 'memory_type',
    hidden: true,
    type: 'select',
    options: ['buffer'],
    defaultValue: 'buffer',
  },
  {
    name: 'model_id',
    label: 'Language Model',
    type: 'select',
    placeholder: 'Select a model',
    required: true,
    searchable: false,
    fetchUrl: '/api/v1/llm',
  },
  {
    name: 'tool_ids',
    label: 'Tools',
    type: 'multiselect',
    placeholder: 'Select tools for the agent',
    required: false,
    multiSelect: true,
    fetchUrl: '/api/v1/tools',
  },
  {
    name: 'visibility',
    label: 'Visibility',
    type: 'select',
    options: ['private', 'shared', 'public'],
    placeholder: 'Select visibility level',
    required: true,
    defaultValue: 'private',
  },
]

const remoteAgentFields: FieldDef[] = [
  {
    name: 'protocol',
    label: 'Protocol',
    type: 'select',
    options: [
      { label: 'LangGraph', value: 'langgraph' },
      { label: 'A2A', value: 'a2a' },
      { label: 'AG-UI', value: 'agui' },
    ],
    defaultValue: 'langgraph',
    required: true,
  },
  {
    name: 'name',
    label: 'Name',
    type: 'text',
    placeholder: 'Enter a name for this deployment',
    required: true,
  },
  {
    name: 'url',
    label: 'Server URL',
    type: 'text',
    placeholder: 'https://agent.example.com',
    required: true,
  },
  {
    name: 'auth_token',
    label: 'Auth Token',
    type: 'password',
    placeholder: 'Leave empty if no auth required',
    required: false,
  },
]

/**
 * Component to show agents and related information in Mantine accordions.
 */
export default function DisplayAgents({ icon }: DisplayAgentsProps) {
  const [sortBy, setSortBy] = useState<string | null>(null)
  const [sortedAgents, setSortedAgents] = useState<DisplayAgent[]>([])
  const [addNewCustomAgent, setAddNewCustomAgent] = useState<boolean>(false)
  const [addNewRemoteAgent, setAddNewRemoteAgent] = useState<boolean>(false)

  const [editKey, setEditKey] = useState<string | null>(null)
  const selectedProjectId = useAtomValue(selectedProjectIdAtom)
  const agentsUrl = selectedProjectId
    ? `/api/v1/agents?project_id=${selectedProjectId}`
    : '/api/v1/agents'
  const llmUrl = selectedProjectId
    ? `/api/v1/llm?project_id=${selectedProjectId}`
    : '/api/v1/llm'

  const previousRemoteAgentCountRef = useRef(0)

  /* Use to manual trigger fetch */
  const { mutate } = useSWRConfig()

  /* Fetch local custom agents */
  const { data: agents } = useSWR(agentsUrl, async (url: string) => {
    const response = await fetch(url)
    const agents = await response.json()
    return agents as Agent[]
  })

  const { data: llmServers } = useSWR(llmUrl, async (url: string) => {
    const response = await fetch(url)
    const llms = await response.json()
    return llms as LLMServer[]
  })

  const { data: availableMcpTools } = useSWR(
    '/api/v1/tools',
    async (url: string) => {
      const response = await fetch(url)
      if (!response.ok) {
        return [] as MCPToolOption[]
      }
      const tools = await response.json()
      return tools as MCPToolOption[]
    },
  )

  /* Fetch remote agent configs */
  const { data: remoteAgents } = useSWR(
    '/api/v1/remote_agent_servers',
    async (url: string) => {
      const response = await fetch(url)
      const remoteAgents = await response.json()
      return remoteAgents as RemoteAgent[]
    },
  )

  const { data: remoteAssistants } = useSWR(
    '/api/v1/remote_agent_servers/agents',
    async (url: string) => {
      const response = await fetch(url)
      const assistants = await response.json()
      return assistants as RemoteAssistant[]
    },
  )

  async function syncRemoteAssistants() {
    const response = await fetch('/api/v1/remote_agent_servers/sync-agents', {
      method: 'POST',
    })

    if (response.ok) {
      mutate('/api/v1/remote_agent_servers')
      mutate('/api/v1/remote_agent_servers/agents')
    }
  }

  // Sync remote assistants on initial load
  useEffect(() => {
    syncRemoteAssistants()
  }, [])

  // Periodic sync every 5 minutes
  useEffect(() => {
    const interval = setInterval(
      () => {
        syncRemoteAssistants()
      },
      5 * 60 * 1000,
    ) // 5 minutes

    return () => clearInterval(interval)
  }, [])

  // When a new remote agent is added, sync immediately to load its assistants
  useEffect(() => {
    const currentCount = remoteAgents?.length || 0
    if (
      remoteAgents !== undefined &&
      currentCount > previousRemoteAgentCountRef.current
    ) {
      syncRemoteAssistants()
    }
    previousRemoteAgentCountRef.current = currentCount
  }, [remoteAgents])

  useEffect(() => {
    const dedupedRemoteAssistants: RemoteAssistant[] = []
    const seenRemoteAssistantIds = new Set<string>()

    for (const assistant of remoteAssistants || []) {
      const key = `${assistant.remote_agent_id}:${assistant.assistant_id}`
      if (seenRemoteAssistantIds.has(key)) {
        continue
      }

      seenRemoteAssistantIds.add(key)
      dedupedRemoteAssistants.push(assistant)
    }

    const combined: DisplayAgent[] = [
      // Custom agents
      ...(agents || []).map((agent) => ({
        type: 'custom' as const,
        id: agent.id,
        name: agent.name,
        sortableVisibility: agent.visibility,
        sortableGraphType: agent.graph_type,
        data: agent,
      })),
      // Remote assistants as first-class agents
      ...(dedupedRemoteAssistants || []).map((assistant) => {
        const remoteServer = remoteAgents?.find(
          (server) => server.id === assistant.remote_agent_id,
        )
        const remoteServerName =
          remoteServer?.name || `Server #${assistant.remote_agent_id}`
        const remoteServerStatus = remoteServer?.status || 'unavailable'

        return {
          type: 'remote-assistant' as const,
          id: `${assistant.remote_agent_id}:${assistant.assistant_id}`,
          name: assistant.name,
          sortableVisibility: 'remote',
          sortableGraphType: assistant.graph_id || 'remote',
          data: assistant,
          remoteServerName,
          remoteServerStatus,
        }
      }),
    ]

    if (sortBy === null) {
      setSortedAgents(combined)
      return
    }

    const sorted = [...combined].sort((a, b) => {
      if (sortBy === 'name') {
        return a.name.localeCompare(b.name)
      }
      if (sortBy === 'type') {
        // Sort custom agents before remote assistants
        if (a.type === 'custom' && b.type === 'remote-assistant') return -1
        if (a.type === 'remote-assistant' && b.type === 'custom') return 1
        return a.type.localeCompare(b.type)
      }
      if (sortBy === 'visibility') {
        return a.sortableVisibility.localeCompare(b.sortableVisibility)
      }
      if (sortBy === 'graph_type') {
        return a.sortableGraphType.localeCompare(b.sortableGraphType)
      }
      return 0
    })

    setSortedAgents(sorted)
  }, [sortBy, agents, remoteAgents, remoteAssistants])

  const customAgentStatusById = useMemo(() => {
    const statusMap: Record<string, 'available' | 'unavailable'> = {}
    const llmIds = new Set((llmServers || []).map((llm) => llm.id))
    const availableToolIds = new Set(
      (availableMcpTools || []).map((tool) => tool.id),
    )

    for (const agent of agents || []) {
      const llmOnline = agent.model_id !== null && llmIds.has(agent.model_id)
      const selectedMcpToolIds = (agent.tool_ids || []).filter((toolId) =>
        toolId.startsWith('mcp:'),
      )
      const mcpOnline = selectedMcpToolIds.every((toolId) =>
        availableToolIds.has(toolId),
      )

      statusMap[agent.id] = llmOnline && mcpOnline ? 'available' : 'unavailable'
    }

    return statusMap
  }, [agents, llmServers, availableMcpTools])

  /**
   * Send a request to delete an agent.
   * @param agentId Agent unique id in the database.
   */
  async function submitDelete(item: DisplayAgent) {
    if (item.type !== 'custom') {
      return
    }

    const endpoint = `/api/v1/agents/${item.id}`

    const response = await fetch(endpoint, {
      method: 'DELETE',
    })

    if (response.ok) {
      mutate(agentsUrl)
    }
  }

  async function submitDeleteServer(serverId: number) {
    const endpoint = `/api/v1/remote_agent_servers/${serverId}`

    const response = await fetch(endpoint, {
      method: 'DELETE',
    })

    if (response.ok) {
      mutate('/api/v1/remote_agent_servers')
      mutate('/api/v1/remote_agent_servers/agents')
    }
  }

  async function submitSyncServer(serverId: number) {
    const endpoint = `/api/v1/remote_agent_servers/${serverId}/agents/sync`

    const response = await fetch(endpoint, {
      method: 'POST',
    })

    if (response.ok) {
      mutate('/api/v1/remote_agent_servers')
      mutate('/api/v1/remote_agent_servers/agents')
    }
  }

  /**
   * Duplicate an agent into a new agent.
   * @param agent Agent object to duplicate.
   */
  async function submitDuplicate(agent: Agent) {
    // Create a new agent based on the existing one
    const duplicateData = {
      name: `${agent.name} (Copy)`,
      description: agent.description,
      system_prompt: agent.system_prompt,
      graph_type: agent.graph_type,
      memory_type: agent.memory_type,
      model_id: agent.model_id,
      tool_ids: agent.tool_ids,
      visibility: agent.visibility,
      parent_agent_id: agent.id,
      version: agent.version + 1,
      runtime_config: agent.runtime_config,
      project_id: selectedProjectId ?? agent.project_id ?? null,
    }

    const response = await fetch('/api/v1/agents', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(duplicateData),
    })

    if (response.ok) {
      mutate(agentsUrl)
    }
  }

  return (
    <>
      <div className='px-3 pt-2'>
        <Menu
          shadow='md'
          withinPortal={false}
          position='bottom-start'
          offset={8}
          width='target'
          styles={{
            dropdown: {
              borderRadius: '12px',
              borderColor: 'var(--mantine-color-gray-3)',
              padding: '6px',
              background: 'var(--mantine-color-body)',
            },
          }}
        >
          <Menu.Target>
            <Button
              size='xs'
              radius={'xl'}
              variant='outline'
              leftSection={<IconPlus size={18} />}
              fullWidth
              color='var(--mantine-color-gray-6)'
            >
              Add agents
            </Button>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item
              onClick={() => {
                setAddNewCustomAgent(true)
                setAddNewRemoteAgent(false)
              }}
            >
              <Group gap='sm' wrap='nowrap'>
                <ThemeIcon size='sm' radius='xl' variant='light' color='gray'>
                  <IHubIconAgent size={14} />
                </ThemeIcon>
                <div>
                  <Text size='sm' fw={600}>
                    Create custom agent
                  </Text>
                  <Text size='xs' c='dimmed'>
                    Build and configure a local agent
                  </Text>
                </div>
              </Group>
            </Menu.Item>
            <Menu.Item
              onClick={() => {
                setAddNewRemoteAgent(true)
                setAddNewCustomAgent(false)
              }}
            >
              <Group gap='sm' wrap='nowrap'>
                <ThemeIcon size='sm' radius='xl' variant='light' color='gray'>
                  <IconPlugConnected size={13} />
                </ThemeIcon>
                <div>
                  <Text size='sm' fw={600}>
                    Add server connection
                  </Text>
                  <Text size='xs' c='dimmed'>
                    Connect a LangGraph, A2A, or AG-UI deployment
                  </Text>
                </div>
              </Group>
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </div>

      <AddConnectionButton
        serverType={'Custom Agent'}
        handleClick={() => setAddNewCustomAgent(false)}
        fields={customAgentFields}
        url={'/api/v1/agents'}
        expand={addNewCustomAgent}
        buttonLabel='Create custom agent'
        formTitle='Create custom agent'
        hideWhenCollapsed
      />

      <AddConnectionButton
        serverType={'Remote Agent'}
        handleClick={() => setAddNewRemoteAgent(false)}
        fields={remoteAgentFields}
        url={'/api/v1/remote_agent_servers'}
        expand={addNewRemoteAgent}
        buttonLabel='Connect remote deployment'
        formTitle='Connect remote deployment'
        hideWhenCollapsed
      />

      <SortDropdown
        options={['name', 'type', 'visibility', 'graph_type']}
        setSortBy={setSortBy}
      />

      <div className='px-3 pb-2'>
        <Text size='xs' fw={700} c='dimmed' tt='uppercase'>
          Remote Agent Deployments
        </Text>
      </div>

      <div
        className='pb-3'
        style={{
          marginLeft: 'var(--mantine-spacing-sm)',
          marginRight: 'var(--mantine-spacing-sm)',
        }}
      >
        {(remoteAgents || []).length === 0 ? (
          <Text size='sm' c='dimmed'>
            No remote deployments configured.
          </Text>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {(remoteAgents || []).map((server, index, arr) => (
              <div
                key={`remote-server-row-${server.id}`}
                style={{ padding: '0.25rem var(--mantine-spacing-md)' }}
              >
                <Group justify='space-between' align='center' wrap='nowrap'>
                  <Group
                    gap='sm'
                    wrap='nowrap'
                    style={{ minWidth: 0, flex: 1 }}
                  >
                    <Avatar size='sm' color='dark' radius='xl'>
                      <IconPlugConnected size={14} />
                    </Avatar>
                    <div style={{ minWidth: 0 }}>
                      <Text size='sm' fw={500} truncate>
                        {server.name}
                      </Text>
                      <Text
                        size='xs'
                        c='dimmed'
                        style={{ fontFamily: 'monospace' }}
                        truncate
                      >
                        {server.url}
                      </Text>
                      <Badge size='xs' variant='light' color='gray'>
                        {server.protocol.toUpperCase()}
                      </Badge>
                    </div>
                  </Group>

                  <Group gap='xs' wrap='nowrap' style={{ flexShrink: 0 }}>
                    <Badge size='xs' color={getStatusBadgeColor(server.status)}>
                      {server.status.toUpperCase()}
                    </Badge>

                    <Menu shadow='md' position='bottom-end' withinPortal>
                      <Menu.Target>
                        <ActionIcon
                          variant='subtle'
                          color='gray'
                          aria-label='Server actions'
                        >
                          <IconDotsVertical size={16} />
                        </ActionIcon>
                      </Menu.Target>
                      <Menu.Dropdown>
                        <Menu.Item onClick={() => submitSyncServer(server.id)}>
                          Sync now
                        </Menu.Item>
                        <Menu.Item
                          onClick={() =>
                            setEditKey(
                              editKey === `remote-server:${server.id}`
                                ? null
                                : `remote-server:${server.id}`,
                            )
                          }
                        >
                          Edit
                        </Menu.Item>
                        <Menu.Item
                          color='red'
                          onClick={() => submitDeleteServer(server.id)}
                        >
                          Delete
                        </Menu.Item>
                      </Menu.Dropdown>
                    </Menu>
                  </Group>
                </Group>

                {editKey === `remote-server:${server.id}` && (
                  <div style={{ marginTop: '0.75rem' }}>
                    <EditConnection
                      serverType={'Remote Agent'}
                      handleClick={() => setEditKey(null)}
                      fields={remoteAgentFields}
                      url={`/api/v1/remote_agent_servers/${server.id}`}
                      currentValues={server}
                      onSuccess={() => {
                        mutate('/api/v1/remote_agent_servers')
                      }}
                    />
                  </div>
                )}

                {index < arr.length - 1 && <Divider my='sm' />}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className='px-3 pb-2'>
        <Text size='xs' fw={700} c='dimmed' tt='uppercase'>
          Agents
        </Text>
      </div>

      <Accordion mx={'sm'} variant='separated' radius={'md'}>
        {sortedAgents?.map((item) => {
          return (
            <div key={`${item.type}-${item.id}`}>
              <AccordionItem value={`${item.type}-${item.id}`}>
                <AccordionControl icon={icon}>
                  <AgentItem
                    item={item}
                    customAgentStatusById={customAgentStatusById}
                  />
                </AccordionControl>
                <AccordionPanel>
                  <Group gap='sm' grow>
                    {item.type === 'custom' && (
                      <>
                        <Button
                          size='xs'
                          radius={'xl'}
                          variant='light'
                          color='var(--mantine-color-blue-6)'
                          leftSection={<IHubIconCopy size={16} />}
                          onClick={() => submitDuplicate(item.data)}
                        >
                          Clone
                        </Button>
                        <Button
                          size='xs'
                          radius={'xl'}
                          variant='light'
                          color='var(--mantine-color-gray-8)'
                          leftSection={<IHubIconEdit size={16} />}
                          onClick={() => setEditKey(`${item.type}:${item.id}`)}
                        >
                          Edit
                        </Button>
                        <Button
                          color='var(--mantine-color-red-6)'
                          onClick={() => submitDelete(item)}
                          leftSection={<IHubIconTrash size={16} />}
                          size='xs'
                          variant='light'
                          radius={'xl'}
                        >
                          Delete
                        </Button>
                      </>
                    )}
                  </Group>
                </AccordionPanel>
                {item.type === 'custom' &&
                  editKey &&
                  editKey === `${item.type}:${item.id}` && (
                    <AccordionPanel>
                      <EditConnection
                        serverType={'Custom Agent'}
                        handleClick={() => setEditKey(null)}
                        fields={customAgentFields}
                        url={`/api/v1/agents/${item.id}`}
                        currentValues={item.data}
                        onSuccess={() => {
                          mutate(agentsUrl)
                        }}
                      />
                    </AccordionPanel>
                  )}
                <AccordionPanel>
                  {item.type === 'custom' ? (
                    <AgentDetails item={item} />
                  ) : (
                    <AssistantDetails
                      assistant={item.data}
                      remoteServerName={item.remoteServerName}
                    />
                  )}
                </AccordionPanel>
              </AccordionItem>
            </div>
          )
        })}
      </Accordion>
    </>
  )
}

/* ------------------------------ Helper Components --------------------- */

/**
 * Component to display basic information about an agent.
 * @param agent Agent object.
 */
interface AgentItemProps {
  item: DisplayAgent
  customAgentStatusById?: Record<string, 'available' | 'unavailable'>
}

function AgentItem({ item, customAgentStatusById }: AgentItemProps) {
  const originLabel =
    item.type === 'custom'
      ? null
      : `${
          item.data.protocol === 'a2a'
            ? 'A2A'
            : item.data.protocol === 'agui'
              ? 'AG-UI'
              : 'Remote'
        } · ${item.remoteServerName}`

  const statusDotColor =
    item.type === 'remote-assistant'
      ? `var(--mantine-color-${getStatusBadgeColor(item.remoteServerStatus)}-6)`
      : null

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        width: '100%',
      }}
    >
      <div style={{ position: 'relative', width: 28, height: 28 }}>
        <Avatar size='sm' color='dark' radius='xl'>
          <IHubIconAgent size={16} />
        </Avatar>
        {item.type === 'remote-assistant' && statusDotColor && (
          <span
            style={{
              position: 'absolute',
              right: -1,
              bottom: -1,
              width: 14,
              height: 14,
              borderRadius: '50%',
              backgroundColor: statusDotColor,
              border: '2px solid var(--mantine-color-body)',
            }}
          />
        )}
      </div>
      <div style={{ flex: 1 }}>
        <Text size='sm' fw={500}>
          {item.name}
        </Text>
        {originLabel && (
          <Text size='xs' c='dimmed' fw={500}>
            {originLabel}
          </Text>
        )}
      </div>
    </div>
  )
}

/**
 * Component to display detailed information about a custom agent.
 */
function AgentDetails({ item }: { item: DisplayAgent & { type: 'custom' } }) {
  const { data: llmModels } = useSWR('/api/v1/llm', async (url: string) => {
    const response = await fetch(url)
    if (!response.ok) return []
    return (await response.json()) as LLMServer[]
  })

  const agent = item.data

  const llmModel = llmModels?.find((llm) => llm.id === agent.model_id)

  return (
    <>
      <Divider my='xs' label='Agent Configuration' />

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {agent.description && (
          <div>
            <Text size='xs' fw={500} c='dimmed'>
              Description
            </Text>
            <Text size='sm'>{agent.description}</Text>
          </div>
        )}

        <div>
          <Text size='xs' fw={500} c='dimmed'>
            Graph Type
          </Text>
          <Text size='sm'>{agent.graph_type}</Text>
        </div>

        <div>
          <Text size='xs' fw={500} c='dimmed'>
            Memory Type
          </Text>
          <Text size='sm'>{agent.memory_type}</Text>
        </div>

        <div>
          <Text size='xs' fw={500} c='dimmed'>
            Visibility
          </Text>
          <Text size='sm' tt='capitalize'>
            {agent.visibility}
          </Text>
        </div>

        <div>
          <Text size='xs' fw={500} c='dimmed'>
            Execution
          </Text>
          <Text size='sm'>Local</Text>
        </div>

        {agent.model_id && llmModel && (
          <div>
            <Text size='xs' fw={500} c='dimmed'>
              Model
            </Text>
            <Text size='sm'>
              {llmModel.label || llmModel.name || llmModel.model}
            </Text>
          </div>
        )}

        {agent.tool_ids && agent.tool_ids.length > 0 && (
          <div>
            <Text size='xs' fw={500} c='dimmed' mb={4}>
              Tools ({agent.tool_ids.length})
            </Text>
            <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
              {agent.tool_ids.map((toolId, idx) => (
                <Badge key={idx} size='xs' variant='light'>
                  {toolId}
                </Badge>
              ))}
            </div>
          </div>
        )}

        <div>
          <Text size='xs' fw={500} c='dimmed' mb={4}>
            System Prompt
          </Text>
          <ScrollArea.Autosize mah={320} offsetScrollbars>
            <div
              style={{
                fontSize: '0.75rem',
                fontFamily: 'monospace',
                lineHeight: 1.5,
              }}
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {agent.system_prompt ?? ''}
              </ReactMarkdown>
            </div>
          </ScrollArea.Autosize>
        </div>
      </div>
    </>
  )
}

/**
 * Component to display details about a remote assistant.
 */
function AssistantDetails({
  assistant,
  remoteServerName,
}: {
  assistant: RemoteAssistant
  remoteServerName: string
}) {
  if (assistant.protocol === 'a2a') {
    return (
      <A2AAgentDetails
        assistant={assistant}
        remoteServerName={remoteServerName}
      />
    )
  }

  if (assistant.protocol === 'agui') {
    return (
      <AGUIAgentDetails
        assistant={assistant}
        remoteServerName={remoteServerName}
      />
    )
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
        fontSize: '0.875rem',
      }}
    >
      {assistant.description && (
        <div>
          <Text size='xs' fw={500} c='dimmed'>
            Description
          </Text>
          <Text size='xs'>{assistant.description}</Text>
        </div>
      )}

      <div>
        <Text size='xs' fw={500} c='dimmed'>
          Source Server
        </Text>
        <Text size='xs'>{remoteServerName}</Text>
      </div>

      <div>
        <Text size='xs' fw={500} c='dimmed'>
          Assistant ID
        </Text>
        <Text
          size='xs'
          style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}
        >
          {assistant.assistant_id}
        </Text>
      </div>

      {assistant.graph_id && (
        <div>
          <Text size='xs' fw={500} c='dimmed'>
            Graph ID
          </Text>
          <Text size='xs'>{assistant.graph_id}</Text>
        </div>
      )}

      <div>
        <Text size='xs' fw={500} c='dimmed'>
          Status
        </Text>
        <Text size='xs' tt='capitalize'>
          {assistant.status}
        </Text>
      </div>

      <div>
        <Text size='xs' fw={500} c='dimmed'>
          Last Synced
        </Text>
        <Text size='xs'>{assistant.last_synced_at}</Text>
      </div>
    </div>
  )
}

function AGUIAgentDetails({
  assistant,
  remoteServerName,
}: {
  assistant: RemoteAssistant
  remoteServerName: string
}) {
  const metadata = assistant.assistant_metadata || {}
  const identity = isRecord(metadata.identity) ? metadata.identity : {}
  const transport = isRecord(metadata.transport) ? metadata.transport : {}
  const tools = isRecord(metadata.tools) ? metadata.tools : {}
  const endpoint = stringValue(metadata, 'endpoint')
  const capabilityLabels = [
    transport.streaming === true ? 'SSE streaming' : null,
    tools.supported === true ? 'Tool calls' : null,
    tools.clientProvided === true ? 'Client-provided tools' : null,
  ].filter((label): label is string => label !== null)

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
        fontSize: '0.875rem',
      }}
    >
      <Divider my='xs' label='AG-UI Agent Endpoint' />

      {(assistant.description || stringValue(identity, 'description')) && (
        <div>
          <Text size='xs' fw={500} c='dimmed'>
            Description
          </Text>
          <Text size='xs'>
            {assistant.description || stringValue(identity, 'description')}
          </Text>
        </div>
      )}

      <Group gap='xl' align='flex-start'>
        <div>
          <Text size='xs' fw={500} c='dimmed'>
            Source
          </Text>
          <Text size='xs'>{remoteServerName}</Text>
        </div>
        <div>
          <Text size='xs' fw={500} c='dimmed'>
            Version
          </Text>
          <Text size='xs'>
            {stringValue(identity, 'version') || 'Not provided'}
          </Text>
        </div>
      </Group>

      <div>
        <Text size='xs' fw={500} c='dimmed'>
          Endpoint
        </Text>
        <Text
          size='xs'
          style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}
        >
          {endpoint || 'Not provided'}
        </Text>
      </div>

      <div>
        <Text size='xs' fw={500} c='dimmed' mb={4}>
          Capabilities
        </Text>
        <Group gap={4}>
          {capabilityLabels.length > 0 ? (
            capabilityLabels.map((label) => (
              <Badge key={label} size='xs' variant='light'>
                {label}
              </Badge>
            ))
          ) : (
            <Text size='xs'>Not declared by the endpoint</Text>
          )}
        </Group>
      </div>

      <div>
        <Text size='xs' fw={500} c='dimmed'>
          Status
        </Text>
        <Text size='xs' tt='capitalize'>
          {assistant.status}
        </Text>
      </div>
    </div>
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(
  record: Record<string, unknown>,
  key: string,
): string | null {
  return typeof record[key] === 'string' ? record[key] : null
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

function A2AAgentDetails({
  assistant,
  remoteServerName,
}: {
  assistant: RemoteAssistant
  remoteServerName: string
}) {
  const card = assistant.assistant_metadata || {}
  const capabilities = isRecord(card.capabilities) ? card.capabilities : {}
  const provider = isRecord(card.provider) ? card.provider : null
  const interfaces = recordArray(card.supportedInterfaces)
  const legacyUrl = stringValue(card, 'url')
  const skills = recordArray(card.skills)
  const inputModes = stringArray(card.defaultInputModes)
  const outputModes = stringArray(card.defaultOutputModes)
  const securitySchemes = isRecord(card.securitySchemes)
    ? Object.keys(card.securitySchemes)
    : []
  const capabilityLabels = [
    capabilities.streaming === true ? 'Streaming' : null,
    capabilities.pushNotifications === true ? 'Push notifications' : null,
    capabilities.extendedAgentCard === true ? 'Extended card' : null,
  ].filter((label): label is string => label !== null)

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
        fontSize: '0.875rem',
      }}
    >
      <Divider my='xs' label='A2A Agent Card' />

      {assistant.description && (
        <div>
          <Text size='xs' fw={500} c='dimmed'>
            Description
          </Text>
          <Text size='xs'>{assistant.description}</Text>
        </div>
      )}

      <Group gap='xl' align='flex-start'>
        <div>
          <Text size='xs' fw={500} c='dimmed'>
            Source
          </Text>
          <Text size='xs'>{remoteServerName}</Text>
        </div>
        <div>
          <Text size='xs' fw={500} c='dimmed'>
            Agent Version
          </Text>
          <Text size='xs'>
            {stringValue(card, 'version') || 'Not provided'}
          </Text>
        </div>
      </Group>

      {provider && (
        <div>
          <Text size='xs' fw={500} c='dimmed'>
            Provider
          </Text>
          <Text size='xs'>
            {stringValue(provider, 'organization') || 'Unknown provider'}
          </Text>
        </div>
      )}

      {typeof card.documentationUrl === 'string' && (
        <div>
          <Text size='xs' fw={500} c='dimmed'>
            Documentation
          </Text>
          <Anchor size='xs' href={card.documentationUrl} target='_blank'>
            {card.documentationUrl}
          </Anchor>
        </div>
      )}

      <div>
        <Text size='xs' fw={500} c='dimmed' mb={4}>
          Capabilities
        </Text>
        <Group gap={4}>
          {capabilityLabels.length > 0 ? (
            capabilityLabels.map((label) => (
              <Badge key={label} size='xs' variant='light'>
                {label}
              </Badge>
            ))
          ) : (
            <Text size='xs'>Standard request/response</Text>
          )}
        </Group>
      </div>

      <div>
        <Text size='xs' fw={500} c='dimmed' mb={4}>
          Content Modes
        </Text>
        <Text size='xs'>Input: {inputModes.join(', ') || 'Not provided'}</Text>
        <Text size='xs'>
          Output: {outputModes.join(', ') || 'Not provided'}
        </Text>
      </div>

      <div>
        <Text size='xs' fw={500} c='dimmed' mb={4}>
          Interfaces
        </Text>
        {interfaces.length > 0 ? (
          interfaces.map((agentInterface, index) => (
            <div key={`${stringValue(agentInterface, 'url')}-${index}`}>
              <Text size='xs' fw={500}>
                {stringValue(agentInterface, 'protocolBinding') || 'A2A'}{' '}
                {stringValue(agentInterface, 'protocolVersion') || ''}
              </Text>
              <Text
                size='xs'
                c='dimmed'
                style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}
              >
                {stringValue(agentInterface, 'url')}
              </Text>
            </div>
          ))
        ) : (
          <Text size='xs' style={{ wordBreak: 'break-all' }}>
            {legacyUrl || 'Not provided'}
          </Text>
        )}
      </div>

      {securitySchemes.length > 0 && (
        <div>
          <Text size='xs' fw={500} c='dimmed' mb={4}>
            Authentication
          </Text>
          <Group gap={4}>
            {securitySchemes.map((scheme) => (
              <Badge key={scheme} size='xs' variant='outline'>
                {scheme}
              </Badge>
            ))}
          </Group>
        </div>
      )}

      <div>
        <Text size='xs' fw={500} c='dimmed' mb={4}>
          Skills ({skills.length})
        </Text>
        <div
          style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}
        >
          {skills.map((skill, index) => {
            const tags = stringArray(skill.tags)
            return (
              <div key={stringValue(skill, 'id') || index}>
                <Text size='xs' fw={600}>
                  {stringValue(skill, 'name') || 'Unnamed skill'}
                </Text>
                <Text size='xs'>
                  {stringValue(skill, 'description') || 'No description'}
                </Text>
                {tags.length > 0 && (
                  <Group gap={4} mt={3}>
                    {tags.map((tag) => (
                      <Badge key={tag} size='xs' variant='light' color='gray'>
                        {tag}
                      </Badge>
                    ))}
                  </Group>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <Text size='xs' c='dimmed'>
        Last synced: {assistant.last_synced_at}
      </Text>
    </div>
  )
}
