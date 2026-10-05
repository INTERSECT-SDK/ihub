import type { ChatData } from '@ihub/utils/types/chat'

export type ChatDownload = {
  fileName: string
  data: ChatData
}

/**
 * Builds a chat download without changing the live editor state.
 *
 * Project-backed chats can supply their canonical filename after a rename.
 * Other consumers continue using the name stored in the chat document.
 */
export function buildChatDownload(
  chatData: ChatData,
  downloadFileName?: string,
): ChatDownload {
  const fileName = downloadFileName ?? chatData.chatName

  return {
    fileName,
    data:
      downloadFileName === undefined
        ? chatData
        : {
            ...chatData,
            chatName: downloadFileName,
          },
  }
}
