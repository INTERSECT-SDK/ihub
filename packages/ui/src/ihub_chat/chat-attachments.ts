import type {
  ChatContentBlock,
  ChatSocketAttachment,
} from '@ihub/utils/types/chat'

import { createMessageId } from './chat-migrations'

export type ChatAttachmentBlock = Extract<
  ChatContentBlock,
  { type: 'attachment' }
>

export const MAX_CHAT_ATTACHMENT_COUNT = 5
export const MAX_CHAT_ATTACHMENT_BYTES = 10 * 1024 * 1024

/** Returns a user-facing validation error for a proposed attachment selection. */
export function validateChatAttachments(
  current: ChatAttachmentBlock[],
  files: File[],
): string | null {
  if (current.length + files.length > MAX_CHAT_ATTACHMENT_COUNT) {
    return `Attach up to ${MAX_CHAT_ATTACHMENT_COUNT} files per message.`
  }

  const totalBytes =
    current.reduce((total, attachment) => total + attachment.size, 0) +
    files.reduce((total, file) => total + file.size, 0)

  if (totalBytes > MAX_CHAT_ATTACHMENT_BYTES) {
    return 'Attachments can total up to 10 MB per message.'
  }

  const emptyFile = files.find((file) => file.size === 0)
  if (emptyFile) {
    return `${emptyFile.name} is empty and cannot be attached.`
  }

  return null
}

function encodeBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000
  let binary = ''

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }

  return btoa(binary)
}

/** Reads a browser file into the persisted chat attachment block shape. */
export async function createChatAttachment(
  file: File,
): Promise<ChatAttachmentBlock> {
  const bytes = new Uint8Array(await file.arrayBuffer())

  return {
    type: 'attachment',
    id: createMessageId('attachment'),
    name: file.name,
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
    data: encodeBase64(bytes),
  }
}

/** Removes UI-only attachment fields for the websocket request contract. */
export function toSocketAttachment(
  attachment: ChatAttachmentBlock,
): ChatSocketAttachment {
  return {
    name: attachment.name,
    mimeType: attachment.mimeType,
    size: attachment.size,
    data: attachment.data,
  }
}
