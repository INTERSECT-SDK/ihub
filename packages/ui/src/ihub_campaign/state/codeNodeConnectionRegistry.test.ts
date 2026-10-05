/* eslint-disable @typescript-eslint/no-require-imports -- Node's direct TS test runner needs require() for sibling TypeScript modules. */
const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')

const {
  createCodeNodeConnectionRegistry,
}: typeof import('./codeNodeConnectionRegistry') = require('./codeNodeConnectionRegistry.ts')

type TestConnection = { readyState: number; name: string }

test('keeps another consumer socket available when one consumer unregisters', () => {
  const registry = createCodeNodeConnectionRegistry<TestConnection>()
  const firstConsumer = Symbol('first')
  const secondConsumer = Symbol('second')
  const firstConnection = { readyState: 1, name: 'first' }
  const secondConnection = { readyState: 1, name: 'second' }

  registry.register('code-1', firstConsumer, firstConnection)
  registry.register('code-1', secondConsumer, secondConnection)

  assert.equal(registry.getOpenConnection('code-1'), firstConnection)
  assert.equal(
    registry.unregister('code-1', firstConsumer, firstConnection),
    true,
  )
  assert.equal(registry.getOpenConnection('code-1'), secondConnection)
})

test('ignores stale cleanup for a replacement consumer socket', () => {
  const registry = createCodeNodeConnectionRegistry<TestConnection>()
  const consumer = Symbol('consumer')
  const staleConnection = { readyState: 1, name: 'stale' }
  const currentConnection = { readyState: 1, name: 'current' }

  registry.register('code-1', consumer, staleConnection)
  registry.register('code-1', consumer, currentConnection)

  assert.equal(registry.unregister('code-1', consumer, staleConnection), false)
  assert.equal(registry.getOpenConnection('code-1'), currentConnection)
})
