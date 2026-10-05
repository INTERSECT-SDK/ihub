/* eslint-disable @typescript-eslint/no-require-imports -- Node's focused runner loads sibling TypeScript modules directly. */
const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')

const { createCapabilityInputSourceOverrideStore } =
  require('./capabilityInputSourceOverrideStore.ts') as typeof import('./capabilityInputSourceOverrideStore')

const sharedKey = {
  provenanceKey: 'campaign:one',
  nodeId: 'capability-one',
  inputPath: 'message.value',
}

test('subscribers for the same capability input observe the same source', () => {
  const store = createCapabilityInputSourceOverrideStore()
  const observed: Array<string | null> = []
  const subscribe = () =>
    store.subscribe(sharedKey, () =>
      observed.push(store.getOverride(sharedKey)),
    )

  subscribe()
  subscribe()
  store.setOverride(sharedKey, 'custom')

  assert.deepEqual(observed, ['custom', 'custom'])
  assert.equal(store.getOverride(sharedKey), 'custom')
})

test('input and provenance keys are isolated', () => {
  const store = createCapabilityInputSourceOverrideStore()
  store.setOverride(sharedKey, 'custom')

  assert.equal(
    store.getOverride({ ...sharedKey, inputPath: 'message.other' }),
    null,
  )
  assert.equal(
    store.getOverride({ ...sharedKey, provenanceKey: 'run:historical' }),
    null,
  )
})

test('separate Campaign stores do not share source choices', () => {
  const first = createCapabilityInputSourceOverrideStore()
  const second = createCapabilityInputSourceOverrideStore()
  first.setOverride(sharedKey, 'upstream')

  assert.equal(first.getOverride(sharedKey), 'upstream')
  assert.equal(second.getOverride(sharedKey), null)
})

test('disposing the Campaign store clears unresolved source choices', () => {
  const store = createCapabilityInputSourceOverrideStore()
  let notifications = 0
  store.subscribe(sharedKey, () => {
    notifications += 1
  })
  store.setOverride(sharedKey, 'upstream')

  store.dispose()

  assert.equal(store.getOverride(sharedKey), null)
  assert.equal(notifications, 2)
})
