import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createEmptyChat } from '@ihub/utils/helpers/create'

test('createEmptyChat emits the stable .ichat document contract', () => {
  const fileName = 'example.ichat'

  const chatFile = createEmptyChat(fileName)

  assert.equal(chatFile.type, 'file')
  assert.equal(chatFile.format, 'text')
  assert.equal(chatFile.name, fileName)
  assert.equal(chatFile.content.chatName, fileName)
  assert.deepEqual(chatFile.content.participants, [])
  assert.deepEqual(chatFile.content.messages, [])
})
