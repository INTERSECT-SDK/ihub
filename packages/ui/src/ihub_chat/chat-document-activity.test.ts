/* eslint-disable @typescript-eslint/no-require-imports -- Node's direct TS test runner uses require() for source-inspection tests. */
const { readFileSync }: typeof import('node:fs') = require('node:fs')
const { join }: typeof import('node:path') = require('node:path')
const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')

const chatSource = readFileSync(join(__dirname, 'Chat.tsx'), 'utf8')
const chatMessagesSource = readFileSync(
  join(__dirname, 'useChatMessages.ts'),
  'utf8',
)

test('chat reports agent work and resumed prompt responses as document activity', () => {
  assert.match(chatSource, /onDocumentActivityChange\?\.\(agentProcessing\)/)
  assert.match(
    chatSource,
    /const handlePromptResponse = \([\s\S]*?\) => \{\s*startAgentProc\(\)\s*sendOrQueueSocketEvent/,
  )
})

test('chat publishes message state before reporting final idle activity', () => {
  assert.match(
    chatMessagesSource,
    /setDocumentContentRef\.current\?\.\(chatDataState/,
  )
  assert.ok(
    chatSource.indexOf('useChatMessages({') <
      chatSource.indexOf('onDocumentActivityChange?.(agentProcessing)'),
  )
})

test('chat clears document activity during unmount', () => {
  assert.match(
    chatSource,
    /\(\) => \(\) => \{\s*onDocumentActivityChange\?\.\(false\)/,
  )
})
