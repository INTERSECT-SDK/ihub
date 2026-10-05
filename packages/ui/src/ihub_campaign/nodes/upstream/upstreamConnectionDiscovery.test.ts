/* eslint-disable @typescript-eslint/no-require-imports -- Node's direct TS test runner needs require() for sibling .ts files without changing package module settings. */
const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')

const { getLogicalUpstreamNodeIds } =
  require('./upstreamConnectionDiscovery.ts') as typeof import('./upstreamConnectionDiscovery')

type TestConnection = Parameters<
  typeof getLogicalUpstreamNodeIds
>[number][number]

function connection(overrides: Partial<TestConnection> = {}): TestConnection {
  return {
    source: 'source-1',
    target: 'consumer-1',
    sourceHandle: 'output-right',
    targetHandle: 'input-left',
    ...overrides,
  }
}

test('canonical incoming connection discovers its source', () => {
  assert.deepEqual(getLogicalUpstreamNodeIds([connection()], []), ['source-1'])
})

test('reverse-horizontal outgoing connection discovers its target', () => {
  const reverseConnection = connection({
    source: 'consumer-1',
    target: 'code-1',
    sourceHandle: 'input-left',
    targetHandle: 'output-right',
  })

  assert.deepEqual(getLogicalUpstreamNodeIds([], [reverseConnection]), [
    'code-1',
  ])
})

test('excludes unrelated outgoing, vertical, and unsupported connections', () => {
  const outgoingConnections = [
    connection({ source: 'consumer-1', target: 'unrelated' }),
    connection({
      source: 'consumer-1',
      target: 'vertical',
      sourceHandle: 'bottom',
      targetHandle: 'top',
    }),
    connection({
      source: 'consumer-1',
      target: 'unsupported',
      sourceHandle: 'input-left',
      targetHandle: 'top',
    }),
  ]

  assert.deepEqual(getLogicalUpstreamNodeIds([], outgoingConnections), [])
})

test('returns duplicate logical upstream IDs once', () => {
  const incomingConnections = [
    connection({ source: 'code-1' }),
    connection({ source: 'code-1', target: 'consumer-2' }),
  ]
  const outgoingConnections = [
    connection({
      source: 'consumer-1',
      target: 'code-1',
      sourceHandle: 'input-left',
      targetHandle: 'output-right',
    }),
  ]

  assert.deepEqual(
    getLogicalUpstreamNodeIds(incomingConnections, outgoingConnections),
    ['code-1'],
  )
})
