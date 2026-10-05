'use client'

import { Agent } from '@ihub/utils/types/agent'
import { ChatParticipant } from '@ihub/utils/types/chat'
import { useCallback, useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'

/**
 * Remote assistant payload returned by remote agent discovery.
 *
 * The pair of `remote_agent_id` and `assistant_id` is treated as the stable
 * identity when deduplicating options for the chat selector.
 */
export type RemoteAssistantOption = {
  remote_agent_id: number
  assistant_id: string
  name: string
  graph_id: string | null
  protocol?: 'langgraph' | 'a2a' | 'agui'
}

/**
 * Configured chat room agent used by websocket connection setup.
 *
 * Remote agents keep their encoded selector id so outbound socket routes and
 * persisted participants can share the same identity string.
 */
export type ChatAgentSelection = {
  id: string
  name: string
  isRemote: boolean
}

/**
 * Normalized local or remote agent option for room configuration controls.
 *
 * `isSupervisor` identifies local agents that can lead group chat. Remote
 * assistants can participate in a room but cannot lead one.
 */
export type ChatAgentOption = {
  value: string
  label: string
  isRemote: boolean
  isSupervisor: boolean
  remoteProtocol?: 'langgraph' | 'a2a' | 'agui'
}

type UseChatAgentsOptions = {
  participants: ChatParticipant[]
  setParticipants: (participants: ChatParticipant[]) => void
}

/**
 * Loads agent catalogs and manages chat room agent selection.
 *
 * The hook handles remote assistant deduplication, persisted
 * participant restoration, supervisor-led group eligibility, and participant
 * synchronization after a room is configured.
 */
export function useChatAgents({
  participants,
  setParticipants,
}: UseChatAgentsOptions) {
  const [selectedAgent, setSelectedAgent] = useState<ChatAgentSelection | null>(
    null,
  )
  const [selectedPrimaryAgentId, setSelectedPrimaryAgentId] = useState<
    string | null
  >(null)
  const [selectedGroupAgentIds, setSelectedGroupAgentIds] = useState<string[]>(
    [],
  )
  const [roomConfigured, setRoomConfigured] = useState(false)

  const { data: agents } = useSWR('/api/v1/agents', async (url: string) => {
    const response = await fetch(url)
    const agentList = await response.json()
    return agentList as Agent[]
  })

  const { data: remoteAssistants } = useSWR(
    '/api/v1/remote_agent_servers/agents',
    async (url: string) => {
      const response = await fetch(url)
      if (!response.ok) {
        return [] as RemoteAssistantOption[]
      }

      const payload: unknown = await response.json()
      return Array.isArray(payload) ? (payload as RemoteAssistantOption[]) : []
    },
  )

  const agentCatalog = useMemo(() => {
    const localAgents = Array.isArray(agents) ? agents : []
    const discoveredRemoteAgents = Array.isArray(remoteAssistants)
      ? remoteAssistants
      : []
    const dedupedRemoteAgents: RemoteAssistantOption[] = []
    const seenRemoteAgentIds = new Set<string>()

    for (const assistant of discoveredRemoteAgents) {
      const key = `${assistant.remote_agent_id}:${assistant.assistant_id}`
      if (seenRemoteAgentIds.has(key)) {
        continue
      }

      seenRemoteAgentIds.add(key)
      dedupedRemoteAgents.push(assistant)
    }

    const localOptions: ChatAgentOption[] = localAgents.map((agent) => ({
      value: agent.id,
      label: agent.name || 'agent missing name',
      isRemote: false,
      isSupervisor: agent.graph_type === 'supervisor',
    }))

    const remoteOptions: ChatAgentOption[] = dedupedRemoteAgents.map(
      (assistant) => ({
        value: `remote:${assistant.remote_agent_id}:${assistant.assistant_id}`,
        label: assistant.name,
        isRemote: true,
        isSupervisor: false,
        remoteProtocol: assistant.protocol,
      }),
    )

    return [...localOptions, ...remoteOptions]
  }, [agents, remoteAssistants])

  const agentOptions = useMemo(
    () =>
      agentCatalog.map((agent) => ({
        value: agent.value,
        label:
          agent.remoteProtocol === 'a2a' || agent.remoteProtocol === 'agui'
            ? `${agent.label} (${agent.remoteProtocol.toUpperCase()})`
            : agent.isRemote
              ? `${agent.label} (Remote)`
              : agent.label,
      })),
    [agentCatalog],
  )

  const selectedPrimaryAgentOption = useMemo(
    () =>
      agentCatalog.find((agent) => agent.value === selectedPrimaryAgentId) ||
      null,
    [agentCatalog, selectedPrimaryAgentId],
  )

  const canUseGroupChat =
    !!selectedPrimaryAgentOption &&
    !selectedPrimaryAgentOption.isRemote &&
    selectedPrimaryAgentOption.isSupervisor
  const hasCollaboratorsSelected =
    canUseGroupChat && selectedGroupAgentIds.length > 0

  const groupAgentOptions = useMemo(() => {
    if (!canUseGroupChat) {
      return []
    }

    return agentCatalog
      .filter((agent) => agent.value !== selectedPrimaryAgentId)
      .map((agent) => ({
        value: agent.value,
        label:
          agent.remoteProtocol === 'a2a' || agent.remoteProtocol === 'agui'
            ? `${agent.label} (${agent.remoteProtocol.toUpperCase()})`
            : agent.isRemote
              ? `${agent.label} (Remote)`
              : agent.label,
      }))
  }, [agentCatalog, canUseGroupChat, selectedPrimaryAgentId])

  const selectedGroupAgentOptions = useMemo(
    () =>
      selectedGroupAgentIds
        .map(
          (agentId) =>
            agentCatalog.find((agent) => agent.value === agentId) || null,
        )
        .filter((agent): agent is ChatAgentOption => agent !== null),
    [agentCatalog, selectedGroupAgentIds],
  )

  const agentParticipants = participants.filter(
    (participant) =>
      participant.userRole === 'assistant' || participant.userRole === 'ai',
  )

  useEffect(() => {
    if (roomConfigured) {
      return
    }

    const assistantParticipants = participants.filter(
      (participant) =>
        participant.userRole === 'assistant' || participant.userRole === 'ai',
    )

    if (assistantParticipants.length === 0) {
      return
    }

    if (!agents?.length) {
      return
    }

    const assistantIds = assistantParticipants.map(
      (participant) => participant.userId,
    )

    const preferredPrimaryAgent = assistantIds
      .map((agentId) => agents.find((agent) => agent.id === agentId) || null)
      .find((agent) => agent?.graph_type === 'supervisor')

    if (preferredPrimaryAgent) {
      setSelectedPrimaryAgentId(preferredPrimaryAgent.id)
      setSelectedGroupAgentIds(
        assistantIds.filter((agentId) => agentId !== preferredPrimaryAgent.id),
      )
      setSelectedAgent({
        id: preferredPrimaryAgent.id,
        name: preferredPrimaryAgent.name,
        isRemote: false,
      })
      setRoomConfigured(true)
      return
    }

    const remoteAssistantParticipant = assistantParticipants.find(
      (participant) => participant.userId.startsWith('remote:'),
    )

    if (remoteAssistantParticipant) {
      setSelectedPrimaryAgentId(remoteAssistantParticipant.userId)
      setSelectedGroupAgentIds([])
      setSelectedAgent({
        id: remoteAssistantParticipant.userId,
        name: remoteAssistantParticipant.userName,
        isRemote: true,
      })
      setRoomConfigured(true)
      return
    }

    const fallbackPrimaryAgent =
      preferredPrimaryAgent ||
      assistantIds
        .map((agentId) => agents.find((agent) => agent.id === agentId) || null)
        .find((agent): agent is Agent => agent !== null)

    if (!fallbackPrimaryAgent) {
      return
    }

    setSelectedPrimaryAgentId(fallbackPrimaryAgent.id)
    setSelectedGroupAgentIds([])
    setSelectedAgent({
      id: fallbackPrimaryAgent.id,
      name: fallbackPrimaryAgent.name,
      isRemote: false,
    })
    setRoomConfigured(true)
  }, [agents, participants, roomConfigured])

  useEffect(() => {
    if (!roomConfigured) {
      return
    }

    const nonAssistantParticipants = participants.filter(
      (participant) =>
        participant.userRole !== 'assistant' && participant.userRole !== 'ai',
    )

    const configuredAgentIds = [
      ...(selectedPrimaryAgentId ? [selectedPrimaryAgentId] : []),
      ...(canUseGroupChat ? selectedGroupAgentIds : []),
    ]

    const assistantParticipantsNext: ChatParticipant[] = Array.from(
      new Set(configuredAgentIds),
    )
      .map((agentId) => {
        if (agentId.startsWith('remote:')) {
          const remoteOption = agentCatalog.find(
            (option) => option.value === agentId,
          )

          return {
            userId: agentId,
            userName: remoteOption?.label || 'Remote assistant',
            userRole: 'assistant',
          }
        }

        const configuredAgent = agents?.find((agent) => agent.id === agentId)
        if (!configuredAgent) {
          return null
        }

        return {
          userId: configuredAgent.id,
          userName: configuredAgent.name,
          userRole: 'assistant',
        }
      })
      .filter(
        (participant): participant is ChatParticipant => participant !== null,
      )

    const nextParticipants = [
      ...nonAssistantParticipants,
      ...assistantParticipantsNext,
    ]

    const participantsUnchanged =
      participants.length === nextParticipants.length &&
      participants.every((participant, index) => {
        const nextParticipant = nextParticipants[index]
        if (!nextParticipant) {
          return false
        }

        return (
          participant.userId === nextParticipant.userId &&
          participant.userName === nextParticipant.userName &&
          participant.userRole === nextParticipant.userRole
        )
      })

    if (!participantsUnchanged) {
      setParticipants(nextParticipants)
    }
  }, [
    agentCatalog,
    agents,
    canUseGroupChat,
    participants,
    roomConfigured,
    selectedGroupAgentIds,
    selectedPrimaryAgentId,
    setParticipants,
  ])

  useEffect(() => {
    if (canUseGroupChat || selectedGroupAgentIds.length === 0) {
      return
    }

    setSelectedGroupAgentIds([])
  }, [canUseGroupChat, selectedGroupAgentIds.length])

  /**
   * Updates the lead agent selection and clears invalid collaborator choices.
   */
  const handlePrimaryAgentChange = useCallback(
    (agentId: string | null) => {
      setSelectedPrimaryAgentId(agentId)
      setSelectedGroupAgentIds((currentIds) =>
        agentId
          ? currentIds.filter((currentId) => currentId !== agentId)
          : currentIds,
      )

      const selected =
        agentCatalog.find((agent) => agent.value === agentId) || null
      const allowGroup =
        !!selected && !selected.isRemote && selected.isSupervisor

      if (!allowGroup) {
        setSelectedGroupAgentIds([])
      }

      if (!roomConfigured) {
        setSelectedAgent(null)
      }
    },
    [agentCatalog, roomConfigured],
  )

  /**
   * Updates selected collaborator ids for supervisor-led group chats.
   */
  const handleGroupAgentChange = useCallback((workerIds: string[]) => {
    setSelectedGroupAgentIds(workerIds)
  }, [])

  /**
   * Commits the current selector state into an active direct or group room.
   */
  const startRoom = useCallback(() => {
    if (!selectedPrimaryAgentId || !selectedPrimaryAgentOption) {
      return
    }

    if (selectedPrimaryAgentOption.isRemote) {
      setSelectedAgent({
        id: selectedPrimaryAgentOption.value,
        name: selectedPrimaryAgentOption.label,
        isRemote: true,
      })
      setSelectedGroupAgentIds([])
      setRoomConfigured(true)
      return
    }

    if (!agents?.length) {
      return
    }

    const primaryAgent = agents.find(
      (agent) => agent.id === selectedPrimaryAgentId,
    )
    if (!primaryAgent) {
      return
    }

    setSelectedAgent({
      id: primaryAgent.id,
      name: primaryAgent.name,
      isRemote: false,
    })

    setRoomConfigured(true)
  }, [agents, selectedPrimaryAgentId, selectedPrimaryAgentOption])

  return {
    agents,
    selectedAgent,
    selectedPrimaryAgentId,
    selectedGroupAgentIds,
    selectedPrimaryAgentOption,
    selectedGroupAgentOptions,
    roomConfigured,
    agentOptions,
    groupAgentOptions,
    canUseGroupChat,
    hasCollaboratorsSelected,
    agentParticipants,
    handlePrimaryAgentChange,
    handleGroupAgentChange,
    startRoom,
  }
}
