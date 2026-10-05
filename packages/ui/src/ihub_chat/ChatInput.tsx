import { ActionIcon, Group, Paper, Pill, Text, Tooltip } from '@mantine/core'
import {
  IHubIconFile,
  IHubIconPaperclip,
  IHubIconSend,
} from '@ihub/utils/icons'
import { ChatContentBlock, ChatParticipant } from '@ihub/utils/types/chat'
import { useCallback, useMemo, useRef, useState } from 'react'
import { Mention, MentionsInput } from 'react-mentions'
import type { MentionsInputStyle, SuggestionDataItem } from 'react-mentions'
import chatInputClasses from './ChatInput.module.css'
import {
  createChatAttachment,
  validateChatAttachments,
} from './chat-attachments'

type ChatAttachment = Extract<ChatContentBlock, { type: 'attachment' }>

/**
 * Props for the chat composer shown at the bottom of iHub chat views.
 */
interface ChatInputProps {
  /** Sends the trimmed message body and any selected file attachments. */
  sendMessage: (message: string, attachments: ChatAttachment[]) => void
  /** Participants that can be suggested when the user types an @ mention. */
  participants?: ChatParticipant[]
  /** Current user ID, excluded from the mention suggestions list. */
  currentUserId?: string
  /** Visual layout mode used by embedded and centered chat experiences. */
  layout?: 'default' | 'centered'
  /** Focuses the underlying message textarea when the component mounts. */
  autoFocus?: boolean
}

/**
 * Chat message composer with participant @mentions and enter-to-send behavior.
 *
 * The component stores both the react-mentions markup value and the plain text
 * value so callers receive a user-readable message rather than mention markup.
 */
export default function ChatInput({
  sendMessage,
  participants = [],
  currentUserId,
  layout = 'default',
  autoFocus = false,
}: ChatInputProps) {
  const isCentered = layout === 'centered'
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [mentionValue, setMentionValue] = useState('')
  const [plainMessage, setPlainMessage] = useState('')
  const [mentionQueryActive, setMentionQueryActive] = useState(false)
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [readingFiles, setReadingFiles] = useState(false)

  /**
   * Builds the unique list of participants that can be mentioned.
   *
   * Suggestions intentionally exclude the current user and duplicate display
   * names because react-mentions renders names as the visible token.
   */
  const mentionableParticipants = useMemo(() => {
    const uniqueNames = new Set<string>()
    const options: ChatParticipant[] = []

    participants.forEach((participant) => {
      if (
        !participant.userName ||
        participant.userId === currentUserId ||
        uniqueNames.has(participant.userName)
      ) {
        return
      }

      uniqueNames.add(participant.userName)
      options.push(participant)
    })

    return options
  }, [participants, currentUserId])

  /**
   * Converts chat participants into the shape required by react-mentions.
   */
  const mentionOptions = useMemo(
    () =>
      mentionableParticipants.map((participant) => ({
        id: participant.userId,
        display: participant.userName,
      })),
    [mentionableParticipants],
  )

  /**
   * Filters mention suggestions for the active query and marks the mention menu
   * as active so Enter selects a suggestion instead of submitting the form.
   */
  const getMentionOptions = useCallback(
    (query: string, callback: (data: SuggestionDataItem[]) => void) => {
      setMentionQueryActive(true)
      const normalizedQuery = query.toLocaleLowerCase()

      callback(
        mentionOptions.filter((option) =>
          option.display.toLocaleLowerCase().includes(normalizedQuery),
        ),
      )
    },
    [mentionOptions],
  )

  /**
   * Sends the current plain-text message, then resets mention state and returns
   * focus to the textarea for fast consecutive messages.
   */
  const submitChatHandler = () => {
    const messageToSend = plainMessage.trim()
    if (!messageToSend && attachments.length === 0) {
      return
    }

    sendMessage(messageToSend, attachments)
    setMentionValue('')
    setPlainMessage('')
    setMentionQueryActive(false)
    setAttachments([])
    setAttachmentError(null)
    textareaRef.current?.focus()
  }

  const addAttachments = async (files: File[]) => {
    const validationError = validateChatAttachments(attachments, files)
    if (validationError) {
      setAttachmentError(validationError)
      return
    }

    setReadingFiles(true)
    setAttachmentError(null)
    try {
      const nextAttachments = await Promise.all(files.map(createChatAttachment))
      setAttachments((current) => [...current, ...nextAttachments])
    } catch {
      setAttachmentError('Unable to read one or more selected files.')
    } finally {
      setReadingFiles(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  /**
   * Shared inline style contract for react-mentions' layered textarea,
   * highlighter, and suggestion list elements.
   */
  const mentionInputStyle = useMemo<MentionsInputStyle>(
    () => ({
      control: {
        fontSize: 'var(--mantine-font-size-md)',
      },
      highlighter: {
        minHeight: 74,
        maxHeight: 170,
        overflow: 'hidden',
        borderRadius: 'var(--mantine-radius-xl)',
        padding: '10px 44px',
        border: 'none',
        backgroundColor: 'transparent',
        color: 'var(--mantine-color-text)',
      },
      input: {
        minHeight: 74,
        maxHeight: 170,
        borderRadius: 'var(--mantine-radius-xl)',
        padding: '10px 44px',
        border: 'none',
        outline: 'none',
        backgroundColor: 'transparent',
        color: 'var(--mantine-color-text)',
        boxShadow: 'none',
      },
      suggestions: {
        list: {
          backgroundColor: 'var(--mantine-color-body)',
          border:
            '1px solid var(--mantine-color-default-border, var(--mantine-color-gray-4))',
          borderRadius: 'var(--mantine-radius-md)',
          boxShadow: 'var(--mantine-shadow-sm)',
          maxHeight: 220,
          overflowY: 'auto',
        },
        item: {
          padding: '8px 12px',
          borderBottom:
            '1px solid var(--mantine-color-default-border, var(--mantine-color-gray-4))',
          cursor: 'pointer',
          '&focused': {
            backgroundColor: 'var(--mantine-color-default-hover)',
          },
        },
      },
    }),
    [],
  )

  return (
    <form
      className={`${chatInputClasses.chatInputForm} ${isCentered ? chatInputClasses.chatInputFormCentered : chatInputClasses.chatInputFormDefault}`}
      onSubmit={(e) => {
        e.preventDefault()
        submitChatHandler()
      }}
      onKeyDown={(e) => {
        if (e.shiftKey && e.key === 'Enter') {
          return
        }

        if (e.key === 'Enter' && !mentionQueryActive) {
          e.preventDefault()
          submitChatHandler()
        }
      }}
    >
      <div className={chatInputClasses.chatInputContainer}>
        <Paper
          withBorder
          mx={isCentered ? 0 : 'lg'}
          my={isCentered ? 'xl' : 'xs'}
          className={`${chatInputClasses.chatInputPaper} ${!isCentered ? chatInputClasses.chatInputPaperDefault : ''} ${isCentered ? chatInputClasses.chatInputPaperCentered : ''}`}
        >
          <input
            ref={fileInputRef}
            type='file'
            multiple
            className={chatInputClasses.chatInputFileInput}
            onChange={(event) => {
              void addAttachments(Array.from(event.currentTarget.files || []))
            }}
          />
          {attachments.length > 0 && (
            <Group gap='xs' px='sm' pt='sm'>
              {attachments.map((attachment) => (
                <Pill
                  key={attachment.id}
                  withRemoveButton
                  onRemove={() => {
                    setAttachments((current) =>
                      current.filter((item) => item.id !== attachment.id),
                    )
                    setAttachmentError(null)
                  }}
                >
                  <Group gap={4} wrap='nowrap'>
                    <IHubIconFile size={14} />
                    <span>{attachment.name}</span>
                  </Group>
                </Pill>
              ))}
            </Group>
          )}
          {attachmentError && (
            <Text size='xs' c='red' px='sm' pt='xs'>
              {attachmentError}
            </Text>
          )}
          <MentionsInput
            value={mentionValue}
            inputRef={textareaRef}
            autoFocus={autoFocus}
            placeholder='Type message here, use @ to tag participants, and press enter to send'
            style={mentionInputStyle}
            allowSpaceInQuery
            allowSuggestionsAboveCursor
            a11ySuggestionsListLabel='Suggested participants'
            onChange={(_event, nextValue, nextPlainTextValue) => {
              setMentionValue(nextValue)
              setPlainMessage(nextPlainTextValue)
            }}
            onBlur={() => setMentionQueryActive(false)}
          >
            <Mention
              trigger='@'
              data={getMentionOptions}
              markup='@[__display__](__id__)'
              displayTransform={(_id, display) => `@${display}`}
              appendSpaceOnAdd
              onAdd={() => {
                setMentionQueryActive(false)
              }}
              style={{
                backgroundColor: 'var(--mantine-color-blue-light)',
                color: 'var(--mantine-color-blue-light-color)',
                borderRadius: 6,
              }}
            />
          </MentionsInput>

          <Tooltip label='Attach files (10 MB total)'>
            <ActionIcon
              radius='xl'
              type='button'
              variant='subtle'
              loading={readingFiles}
              aria-label='Attach files'
              className={chatInputClasses.chatInputAttachButton}
              onClick={() => fileInputRef.current?.click()}
            >
              <IHubIconPaperclip style={{ height: '70%', width: '70%' }} />
            </ActionIcon>
          </Tooltip>

          <Tooltip label='Send'>
            <ActionIcon
              radius='xl'
              type='submit'
              variant='filled'
              disabled={readingFiles}
              className={chatInputClasses.chatInputSendButton}
            >
              <IHubIconSend style={{ height: '70%', width: '70%' }} />
            </ActionIcon>
          </Tooltip>
        </Paper>
      </div>
    </form>
  )
}
