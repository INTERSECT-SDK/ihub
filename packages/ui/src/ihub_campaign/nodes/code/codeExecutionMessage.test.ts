/* eslint-disable @typescript-eslint/no-require-imports -- Node directly executes focused TypeScript tests in this package. */
const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')
const { reduceCodeExecutionMessage } =
  require('./codeExecutionMessage.ts') as typeof import('./codeExecutionMessage')

test('code execution message reduction ignores malformed and unrelated traffic', () => {
  assert.deepEqual(reduceCodeExecutionMessage('not-json', 'exec-1'), {
    kind: 'invalid-json',
  })
  assert.deepEqual(
    reduceCodeExecutionMessage(
      JSON.stringify({ parent_header: { msg_id: 'other' } }),
      'exec-1',
    ),
    { kind: 'ignored' },
  )
})

test('code execution message reduction converts output and execution state', () => {
  assert.deepEqual(
    reduceCodeExecutionMessage(
      JSON.stringify({
        parent_header: { msg_id: 'exec-1' },
        header: { msg_type: 'stream' },
        content: { execution_count: 4, name: 'stdout', text: 'done' },
      }),
      'exec-1',
    ),
    {
      kind: 'update',
      update: {
        executionCount: 4,
        output: { output_type: 'stream', name: 'stdout', text: 'done' },
      },
    },
  )

  assert.deepEqual(
    reduceCodeExecutionMessage(
      JSON.stringify({
        parent_header: { msg_id: 'exec-1' },
        header: { msg_type: 'execute_reply' },
        content: {},
      }),
      'exec-1',
    ),
    { kind: 'update', update: { isComplete: true } },
  )
})
