export type LLMServer = {
  id: number
  name?: string
  model?: string
  url?: string
  location?: string
  apiKey?: string
  temperature?: number
  process_prompt?: boolean
  maxTokens?: number
  deployment_name?: string
  api_version?: string
  provider?: string
  label?: string
}

export enum Role {
  ai = 'ai',
  assistant = 'assistant',
  developer = 'developer',
  human = 'human',
  system = 'system',
  tool = 'tool',
  user = 'user',
}

export type ChatParticipant = {
  userId: string
  userName: string
  userRole:
    | 'ai'
    | 'assistant'
    | 'developer'
    | 'human'
    | 'system'
    | 'tool'
    | 'user'
}

export type ChatMessageStatus =
  | 'pending'
  | 'streaming'
  | 'complete'
  | 'error'
  | 'awaiting_input'

export type ChatBlockStatus = 'pending' | 'running' | 'complete' | 'error'

export type ChatPromptOption = {
  label: string
  value: string
  description?: string
}

export type ChatToolExecutionTimelineEntry = {
  type: 'start' | 'progress' | 'result'
  at: string
  detail?: string
  value?: number
  max?: number
  summary?: string
}

export type ChatContentBlock =
  | {
      type: 'markdown'
      text: string
    }
  | {
      type: 'status'
      text: string
      tone?: 'info' | 'success' | 'warning' | 'error'
    }
  | {
      type: 'tool_execution'
      toolCallId: string
      toolName: string
      label?: string
      detail?: string
      value?: number
      max?: number
      status?: ChatBlockStatus
      summary?: string
      data?: unknown
      displayHint?: string
      startedAt?: string
      completedAt?: string
      timeline?: ChatToolExecutionTimelineEntry[]
    }
  | {
      type: 'progress'
      toolCallId?: string
      label: string
      value?: number
      max?: number
      detail?: string
      status?: ChatBlockStatus
    }
  | {
      type: 'tool_result'
      toolCallId?: string
      toolName: string
      summary?: string
      data?: unknown
      displayHint?: string
    }
  | {
      type: 'prompt'
      promptId: string
      label: string
      inputType: 'text' | 'confirm' | 'select'
      placeholder?: string
      options?: ChatPromptOption[]
      submitted?: boolean
      response?: string | boolean | string[]
    }
  | {
      type: 'visualization'
      title?: string
      format: 'vega' | 'vega-lite' | 'plotly' | 'json'
      spec: unknown
    }
  | {
      type: 'image'
      data: string
      mimeType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
      alt?: string
      width?: number
      height?: number
      sourcePath?: string
    }
  | {
      type: 'attachment'
      id: string
      name: string
      mimeType: string
      size: number
      data: string
    }
  | {
      type: 'json'
      label?: string
      data: unknown
    }

export type ChatMessage = {
  id?: string
  senderId: string
  content: string | ChatContentBlock[]
  timestamp: string
  messageType: 'text' | 'rich'
  status: ChatMessageStatus
  display: boolean
  flowcept?: boolean
  metadata?: Record<string, unknown>
}

export type ChatData = {
  chatId: string
  chatName: string
  participants: ChatParticipant[]
  messages: ChatMessage[]
  createdAt: string
  updatedAt: string
}

export type ChatFile = {
  type: 'file'
  format: 'text'
  content: ChatData
  name: string
  [key: string]: any
}

export type ChatSocketMessageInput = {
  role: 'user' | 'assistant'
  content: string | ChatSocketContentBlock[]
  senderId?: string
}

export type ChatSocketAttachment = {
  name: string
  mimeType: string
  size: number
  data: string
}

export type ChatSocketContentBlock =
  | {
      type: 'text'
      text: string
    }
  | {
      type: 'attachment'
      attachment: ChatSocketAttachment
    }

export type ChatSocketClientEvent =
  | {
      type: 'session.start'
      conversationId: string
      supervisorAgentId?: string | null
      participantAgentIds?: string[]
    }
  | {
      type: 'user.message'
      conversationId: string
      message: string
      messages: ChatSocketMessageInput[]
      attachments?: ChatSocketAttachment[]
      supervisorAgentId?: string | null
      participantAgentIds?: string[]
    }
  | {
      type: 'user.prompt_response'
      conversationId: string
      promptId: string
      response: string | boolean | string[]
    }
  | {
      type: 'conversation.clear'
      conversationId: string
      participantAgentIds?: string[]
    }

export type ChatSocketServerEvent =
  | {
      type: 'session.ready'
      conversationId: string
    }
  | {
      type: 'conversation.cleared'
      conversationId: string
    }
  | {
      type: 'message.start'
      conversationId: string
      messageId: string
      senderId: string
      timestamp: string
    }
  | {
      type: 'message.delta'
      conversationId: string
      messageId: string
      delta: string
    }
  | {
      type: 'message.complete'
      conversationId: string
      messageId: string
      content: string
    }
  | {
      type: 'tool.start'
      conversationId: string
      messageId: string
      toolCallId: string
      toolName: string
      input?: unknown
      timestamp: string
    }
  | {
      type: 'tool.progress'
      conversationId: string
      messageId: string
      toolCallId: string
      label: string
      value?: number
      max?: number
      detail?: string
      status?: ChatBlockStatus
    }
  | {
      type: 'tool.result'
      conversationId: string
      messageId: string
      toolCallId: string
      toolName: string
      result?: unknown
      displayHint?: string
    }
  | {
      type: 'prompt.request'
      conversationId: string
      messageId: string
      prompt: Extract<ChatContentBlock, { type: 'prompt' }>
    }
  | {
      type: 'visualization'
      conversationId: string
      messageId: string
      block: Extract<ChatContentBlock, { type: 'visualization' }>
    }
  | {
      type: 'error'
      conversationId: string
      messageId?: string
      error: string
    }
