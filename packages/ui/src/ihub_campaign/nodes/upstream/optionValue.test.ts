/* eslint-disable @typescript-eslint/no-require-imports -- Node's direct TS test runner needs require() for focused sibling modules. */
const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')

const { buildUpstreamOptionValue, parseUpstreamOptionValue } =
  require('./variableOptions.ts') as typeof import('./variableOptions')

test('buildUpstreamOptionValue preserves the existing select value format', () => {
  assert.equal(
    buildUpstreamOptionValue('source-node', 'result.temperature'),
    'source-node:::result.temperature',
  )
})

test('parseUpstreamOptionValue decodes an upstream select value', () => {
  assert.deepEqual(
    parseUpstreamOptionValue('source-node:::result.temperature'),
    {
      sourceNodeId: 'source-node',
      sourcePath: 'result.temperature',
    },
  )
})

test('parseUpstreamOptionValue preserves source paths containing the delimiter', () => {
  assert.deepEqual(parseUpstreamOptionValue('source-node:::result:::value'), {
    sourceNodeId: 'source-node',
    sourcePath: 'result:::value',
  })
})
