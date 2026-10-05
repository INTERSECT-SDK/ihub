'use client'

import {
  ChatContentBlock,
  ChatData,
  ChatMessage,
  ChatSocketMessageInput,
} from '@ihub/utils/types/chat'
import { UserProfile } from '@ihub/utils/types/types'
import { downloadJson } from '@ihub/utils/helpers/download'
import {
  IHubIconAgent,
  IHubIconDownload,
  IHubIconMoveDown,
  IHubIconTrash,
} from '@ihub/utils/icons'
import {
  Avatar,
  Badge,
  Button,
  Divider,
  MultiSelect,
  Paper,
  Popover,
  Select,
  Stack,
  Text,
} from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { useEffect, useMemo, useState } from 'react'

import { TopMenuButton } from '../navigation/TopMenuButton'
import { TopMenuBar } from '../navigation/TopMenuBar'
import ChatArea from './ChatArea'
import ChatInput from './ChatInput'
import chatClasses from './Chat.module.css'
import { toSocketAttachment } from './chat-attachments'
import { buildChatDownload } from './chat-download'
import {
  createConversationId,
  normalizeConversationId,
} from './chat-migrations'
import { useChatAgents } from './useChatAgents'
import { useChatMessages } from './useChatMessages'
import { useChatScroll } from './useChatScroll'
import { useChatSocket } from './useChatSocket'

interface ChatProps {
  chatData: ChatData
  currentUser: UserProfile
  setDocumentContent?: (
    chatData: ChatData,
    options?: { dirty?: boolean },
  ) => void
  downloadFileName?: string
  onDocumentActivityChange?: (active: boolean) => void
}

/**
 * Renders the iHub chat workspace for a single conversation.
 *
 * The component owns the user-facing chat shell: agent and participant
 * selection, message history rendering, composer placement, socket-backed agent
 * responses, and persistence callbacks for edited chat data.
 */
export default function Chat({
  chatData,
  currentUser,
  setDocumentContent,
  downloadFileName,
  onDocumentActivityChange,
}: ChatProps) {
  const [sending, { close: stopSending, open: startSending }] =
    useDisclosure(false)
  const [agentProcessing, { close: stopAgentProc, open: startAgentProc }] =
    useDisclosure(false)
  const [conversationId] = useState(() => {
    return normalizeConversationId(chatData.chatId) || createConversationId()
  })

  const {
    chatDataState,
    userLookup,
    appendUserMessage,
    ensureAssistantMessage,
    appendBlock,
    appendDelta,
    completeMessage,
    markMessageError,
    upsertToolExecution,
    clearMessages,
    setParticipants,
  } = useChatMessages({
    chatData,
    currentUser,
    setDocumentContent,
  })

  const {
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
  } = useChatAgents({
    participants: chatDataState.participants,
    setParticipants,
  })

  const hasMessages = chatDataState.messages.length > 0
  const showCenteredComposer = roomConfigured && !!selectedAgent && !hasMessages

  const { chatAreaRef, showScrollToBottom, scrollToBottom, enableAutoScroll } =
    useChatScroll({
      messages: chatDataState.messages,
      agentProcessing,
    })

  const {
    agentError,
    setAgentError,
    socketState,
    sendOrQueueSocketEvent,
    clearAllDeltaState,
    buildSessionStartEvent,
  } = useChatSocket({
    selectedAgent,
    roomConfigured,
    conversationId,
    canUseGroupChat,
    selectedPrimaryAgentId,
    selectedGroupAgentIds,
    startAgentProcessing: startAgentProc,
    stopAgentProcessing: stopAgentProc,
    ensureAssistantMessage,
    appendBlock,
    appendDelta,
    completeMessage,
    markMessageError,
    upsertToolExecution,
    clearMessages,
  })

  useEffect(() => {
    onDocumentActivityChange?.(agentProcessing)
  }, [agentProcessing, onDocumentActivityChange])

  useEffect(
    () => () => {
      onDocumentActivityChange?.(false)
    },
    [onDocumentActivityChange],
  )

  const buildSocketHistory = (
    chatHistory: ChatMessage[],
  ): ChatSocketMessageInput[] => {
    return chatHistory.flatMap((message) => {
      const participantRole = userLookup[message.senderId]?.userRole
      const role =
        participantRole === 'assistant' || participantRole === 'ai'
          ? 'assistant'
          : 'user'

      if (Array.isArray(message.content)) {
        const text = message.content
          .filter((block) => block.type === 'markdown')
          .map((block) => block.text)
          .join('\n\n')
          .trim()
        const attachments = message.content.filter(
          (block): block is Extract<ChatContentBlock, { type: 'attachment' }> =>
            block.type === 'attachment',
        )

        if (!text && attachments.length === 0) {
          return []
        }

        return [
          {
            role,
            senderId: message.senderId,
            content:
              attachments.length > 0
                ? [
                    ...(text ? [{ type: 'text' as const, text }] : []),
                    ...attachments.map((attachment) => ({
                      type: 'attachment' as const,
                      attachment: toSocketAttachment(attachment),
                    })),
                  ]
                : text,
          },
        ]
      }

      return [
        {
          role,
          senderId: message.senderId,
          content: String(message.content),
        },
      ]
    })
  }

  const sendUserMessage = (
    message: string,
    attachments: Extract<ChatContentBlock, { type: 'attachment' }>[],
  ) => {
    if (!selectedAgent?.id || !roomConfigured) {
      return
    }

    startSending()
    setAgentError(null)

    appendUserMessage(message, attachments)

    enableAutoScroll()
    window.setTimeout(() => {
      scrollToBottom('auto')
    }, 0)

    const sessionEvent = buildSessionStartEvent()
    if (sessionEvent) {
      sendOrQueueSocketEvent(sessionEvent)
    }

    startAgentProc()
    sendOrQueueSocketEvent({
      type: 'user.message',
      conversationId,
      message,
      messages: buildSocketHistory(chatDataState.messages),
      attachments: attachments.map(toSocketAttachment),
      supervisorAgentId: canUseGroupChat ? selectedPrimaryAgentId : undefined,
      participantAgentIds: canUseGroupChat ? selectedGroupAgentIds : undefined,
    })

    stopSending()
  }

  const handlePromptResponse = (
    promptId: string,
    response: string | boolean | string[],
  ) => {
    startAgentProc()
    sendOrQueueSocketEvent({
      type: 'user.prompt_response',
      conversationId,
      promptId,
      response,
    })
  }

  const socketBadgeLabel = useMemo(
    () => (socketState === 'connected' ? 'Connected' : 'Connecting'),
    [socketState],
  )

  return (
    <div className={chatClasses.chatContainer}>
      <TopMenuBar
        pb={0}
        leftItems={
          <>
            <TopMenuButton
              Icon={IHubIconTrash}
              hoverInfo='Erase chat history'
              onClick={() => {
                clearAllDeltaState()
                clearMessages()

                if (roomConfigured && selectedAgent?.id) {
                  sendOrQueueSocketEvent({
                    type: 'conversation.clear',
                    conversationId,
                    participantAgentIds: canUseGroupChat
                      ? selectedGroupAgentIds
                      : undefined,
                  })
                }
              }}
            />
          </>
        }
        rightItems={
          <>
            {roomConfigured && (
              <Badge
                color={socketState === 'connected' ? 'blue' : 'yellow'}
                variant='light'
              >
                {socketBadgeLabel}
              </Badge>
            )}
            {roomConfigured && (
              <Popover width={320} position='bottom-end' withArrow shadow='md'>
                <Popover.Target>
                  <Badge
                    style={{ cursor: 'pointer', maxWidth: 320 }}
                    leftSection={<IHubIconAgent size={14} stroke={1.8} />}
                  >
                    {`${agentParticipants.length} Agents`}
                  </Badge>
                </Popover.Target>
                <Popover.Dropdown>
                  <Stack gap='xs'>
                    <Text size='xs' fw={600} c='dimmed'>
                      Agent Participants
                    </Text>
                    {agentParticipants.length > 0 ? (
                      agentParticipants.map((participant) => {
                        const isPrimary =
                          participant.userId === selectedPrimaryAgentId

                        return (
                          <div
                            key={participant.userId}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: 10,
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                minWidth: 0,
                              }}
                            >
                              <Avatar size='sm' radius='xl'>
                                {participant.userName.slice(0, 2).toUpperCase()}
                              </Avatar>
                              <Text size='sm' truncate>
                                {participant.userName}
                              </Text>
                            </div>
                            <Badge
                              size='sm'
                              variant='light'
                              color={isPrimary ? 'blue' : 'gray'}
                            >
                              {isPrimary ? 'Primary' : 'Member'}
                            </Badge>
                          </div>
                        )
                      })
                    ) : (
                      <Text size='xs' c='dimmed'>
                        No agents in this room yet.
                      </Text>
                    )}
                  </Stack>
                </Popover.Dropdown>
              </Popover>
            )}
            {agentError && (
              <Popover width={260} position='bottom' withArrow shadow='md'>
                <Popover.Target>
                  <Badge color='red' variant='light'>
                    Agent error
                  </Badge>
                </Popover.Target>
                <Popover.Dropdown>
                  <Text size='xs'>{agentError}</Text>
                </Popover.Dropdown>
              </Popover>
            )}
            <TopMenuButton
              Icon={IHubIconDownload}
              hoverInfo='Download chat history'
              onClick={() => {
                const download = buildChatDownload(
                  chatDataState,
                  downloadFileName,
                )
                downloadJson(download.fileName, download.data)
              }}
            />
          </>
        }
      />

      <div ref={chatAreaRef} className={chatClasses.chatAreaRef}>
        <div className={chatClasses.chatAreaStickyHeader} aria-hidden />
        {!roomConfigured ? (
          <div className={chatClasses.chatAreaEmptyState}>
            <Paper
              withBorder
              radius='lg'
              p='lg'
              w='100%'
              maw={680}
              className={chatClasses.chatEmptyCard}
            >
              <Stack gap='lg'>
                <Stack gap={2}>
                  <Text fw={700} size='xl'>
                    Start a conversation
                  </Text>
                  <Text size='sm' c='dimmed'>
                    Select agent(s) and start chatting.
                  </Text>
                </Stack>

                <Divider />

                <Stack gap='sm'>
                  <Text size='xs' fw={700} c='dimmed' tt='uppercase'>
                    Agent
                  </Text>
                  <Select
                    leftSectionPointerEvents='none'
                    leftSection={<IHubIconAgent size={15} stroke={1} />}
                    size='md'
                    radius='md'
                    placeholder='Choose an agent'
                    onChange={handlePrimaryAgentChange}
                    data={agentOptions}
                    value={selectedPrimaryAgentId || ''}
                    searchable
                  />
                </Stack>

                <Stack gap='xs'>
                  <Text size='xs' fw={700} c='dimmed' tt='uppercase'>
                    Conversation options
                  </Text>
                  {selectedPrimaryAgentOption && !canUseGroupChat && (
                    <Text size='xs' c='dimmed'>
                      Collaborators are available only when the lead agent is a
                      supervisor.
                    </Text>
                  )}
                  {canUseGroupChat && (
                    <Text size='xs' c='dimmed'>
                      Add up to 8 local or remote participants. Use @supervisor
                      to address the lead directly.
                    </Text>
                  )}
                </Stack>

                {canUseGroupChat && (
                  <Stack gap='sm'>
                    <Text size='xs' fw={700} c='dimmed' tt='uppercase'>
                      Additional agents
                    </Text>
                    <MultiSelect
                      size='md'
                      radius='md'
                      placeholder='Add agents (optional)'
                      data={groupAgentOptions}
                      value={selectedGroupAgentIds}
                      onChange={handleGroupAgentChange}
                      maxValues={8}
                      searchable
                      clearable
                    />
                  </Stack>
                )}

                {selectedPrimaryAgentOption && (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <Badge size='md' radius='sm' variant='filled' color='blue'>
                      Lead: {selectedPrimaryAgentOption.label}
                    </Badge>
                    {selectedGroupAgentOptions.length > 0
                      ? selectedGroupAgentOptions.map((agent) => (
                          <Badge
                            key={agent.value}
                            size='md'
                            radius='sm'
                            variant='light'
                            color='blue'
                          >
                            {agent.label}
                          </Badge>
                        ))
                      : null}
                  </div>
                )}

                <Button
                  size='md'
                  radius='md'
                  onClick={startRoom}
                  disabled={!selectedPrimaryAgentId}
                  fullWidth
                  color='blue'
                >
                  {hasCollaboratorsSelected ? 'Start group chat' : 'Start chat'}
                </Button>
              </Stack>
            </Paper>
          </div>
        ) : showCenteredComposer ? (
          <div className={chatClasses.chatAreaReadyState}>
            <Stack
              w='100%'
              gap='sm'
              className={chatClasses.chatAreaReadyContent}
            >
              <div className={chatClasses.chatAreaReadyHeader}>
                <Stack gap={2}>
                  <Text fw={700} size='lg'>
                    {hasCollaboratorsSelected
                      ? 'Group chat ready'
                      : 'Direct chat ready'}
                  </Text>
                  <Text size='sm' c='dimmed'>
                    Send your opening message to begin the conversation.
                  </Text>
                </Stack>
              </div>

              <ChatInput
                sendMessage={sendUserMessage}
                participants={chatDataState.participants}
                currentUserId={currentUser.id}
                layout='centered'
                autoFocus
              />
            </Stack>
          </div>
        ) : (
          <ChatArea
            chatParticipants={chatDataState.participants}
            chatHistory={chatDataState.messages}
            otherAgentTyping={agentProcessing || sending}
            currentUser={currentUser}
            onPromptResponse={handlePromptResponse}
          />
        )}
        {roomConfigured && hasMessages && showScrollToBottom && (
          <div aria-hidden className={chatClasses.chatAreaBottomFade} />
        )}
      </div>

      {selectedAgent && roomConfigured && hasMessages ? (
        <div style={{ position: 'relative' }}>
          {showScrollToBottom && (
            <Button
              size='xs'
              radius='xl'
              color='blue'
              variant='outline'
              aria-label='Jump to latest'
              onClick={() => {
                scrollToBottom()
              }}
              className={chatClasses.chatJumpButton}
            >
              <IHubIconMoveDown size={16} />
            </Button>
          )}
          <ChatInput
            sendMessage={sendUserMessage}
            participants={chatDataState.participants}
            currentUserId={currentUser.id}
            autoFocus
          />
        </div>
      ) : !roomConfigured ? (
        <div className={chatClasses.chatUnconfiguredFooter}></div>
      ) : null}
    </div>
  )
}
