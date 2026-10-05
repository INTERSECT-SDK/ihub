/* eslint-disable @typescript-eslint/no-require-imports -- Node's direct TS test runner uses require(). */
const assert: typeof import('node:assert/strict') = require('node:assert/strict')
const { test }: typeof import('node:test') = require('node:test')

const {
  buildChatDownload,
}: typeof import('./chat-download') = require('./chat-download.ts')

const chatData: import('@ihub/utils/types/chat').ChatData = {
  chatId: 'chat-1',
  chatName: 'stale-name.ichat',
  participants: [],
  messages: [],
  createdAt: '2026-07-29T12:00:00.000Z',
  updatedAt: '2026-07-29T12:00:00.000Z',
}

test('canonical filename replaces the exported chat name without mutating state', () => {
  const download = buildChatDownload(chatData, 'renamed δ.ichat')

  assert.equal(download.fileName, 'renamed δ.ichat')
  assert.equal(download.data.chatName, 'renamed δ.ichat')
  assert.notEqual(download.data, chatData)
  assert.equal(chatData.chatName, 'stale-name.ichat')
})

test('stored chat name remains the download fallback', () => {
  const download = buildChatDownload(chatData)

  assert.equal(download.fileName, 'stale-name.ichat')
  assert.equal(download.data.chatName, 'stale-name.ichat')
  assert.equal(download.data, chatData)
})
