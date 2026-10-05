/* eslint-disable @typescript-eslint/no-require-imports -- Node's direct TS test runner needs require() for focused sibling modules. */
const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')

const {
  createCapabilityInputViewState,
  getCapabilityInputItemKey,
  getDisplayedCapabilityInputViewState,
  getManualValueDisplay,
  synchronizeCapabilityManualValue,
} = require('./inputSource.ts') as typeof import('./inputSource')

const inputPath = 'message.value'

function createViewState({
  manualValue,
  selectedValue = null,
  hasUpstreamOptions = true,
}: {
  manualValue?: unknown
  selectedValue?: string | null
  hasUpstreamOptions?: boolean
}) {
  const manualInputValues =
    manualValue === undefined ? {} : { [inputPath]: manualValue }

  return createCapabilityInputViewState({
    persistedValue: manualValue,
    defaultValue: 'default',
    selectedUpstreamValue: selectedValue,
    manualInputValues,
    inputPath,
    hasUpstreamOptions,
  })
}

test('manual display values consistently prefer persisted values over defaults', () => {
  assert.equal(getManualValueDisplay(0, 12), '0')
  assert.equal(getManualValueDisplay(false, true), 'false')
  assert.equal(getManualValueDisplay(null, 12), '12')
  assert.equal(getManualValueDisplay(undefined, undefined), '')
})

test('a persisted clear does not restore or explicitly persist the schema default', () => {
  const customValue = createViewState({ manualValue: 'custom value' })
  assert.equal(customValue.manualValue, 'custom value')

  const clearedLocally = synchronizeCapabilityManualValue({
    currentManualValue: '',
    displayedManualValue: 'custom value',
    persistedValue: 'custom value',
    ownership: { kind: 'editing', displayValue: '' },
  })
  assert.deepEqual(clearedLocally, {
    manualValue: '',
    ownership: { kind: 'editing', displayValue: '' },
  })

  const clearAcknowledged = synchronizeCapabilityManualValue({
    currentManualValue: '',
    displayedManualValue: 'default',
    persistedValue: undefined,
    ownership: { kind: 'persisting', persistedValue: undefined },
  })
  assert.deepEqual(clearAcknowledged, {
    manualValue: '',
    ownership: null,
  })

  assert.equal(
    createViewState({ manualValue: undefined }).manualValue,
    'default',
  )
})

test('external primitive manual values synchronize after local ownership ends', () => {
  for (const value of ['updated', 0, false]) {
    const displayedManualValue = getManualValueDisplay(value, 'default')
    assert.deepEqual(
      synchronizeCapabilityManualValue({
        currentManualValue: 'stale',
        displayedManualValue,
        persistedValue: value,
        ownership: null,
      }),
      { manualValue: displayedManualValue, ownership: null },
    )
  }
})

test('view changes reset local input state for identical node and input IDs', () => {
  const currentB = createViewState({ manualValue: 'B' })
  const historicalA = createViewState({
    manualValue: 'A',
    selectedValue: 'upstream-a:::message.result',
  })
  const historicalB = createViewState({ manualValue: 'run B' })
  const restoredCurrentB = createViewState({ manualValue: 'B' })

  assert.deepEqual(currentB, {
    inputSource: 'custom',
    manualValue: 'B',
    selectedValue: null,
  })
  assert.deepEqual(historicalA, {
    inputSource: 'upstream',
    manualValue: 'A',
    selectedValue: 'upstream-a:::message.result',
  })
  assert.deepEqual(historicalB, {
    inputSource: 'custom',
    manualValue: 'run B',
    selectedValue: null,
  })
  assert.deepEqual(restoredCurrentB, currentB)
})

test('only capability input descendants are keyed by run provenance', () => {
  assert.equal(
    getCapabilityInputItemKey('campaign:current', inputPath),
    'campaign:current:message.value',
  )
  assert.equal(
    getCapabilityInputItemKey('run:a', inputPath),
    'run:a:message.value',
  )
})

test('historical inputs render snapshot state without copying it into local state', () => {
  const staleLocalState = createViewState({ manualValue: 'current B' })
  const historicalState = createViewState({
    manualValue: 'run A',
    selectedValue: 'upstream-a:::message.result',
  })

  assert.equal(
    getDisplayedCapabilityInputViewState(
      historicalState,
      staleLocalState,
      true,
    ),
    historicalState,
  )
  assert.equal(
    getDisplayedCapabilityInputViewState(
      historicalState,
      staleLocalState,
      false,
    ),
    staleLocalState,
  )
})

test('historical inputs ignore a current-view source override', () => {
  const historicalState = createViewState({ manualValue: 'run value' })
  const currentOverrideState = {
    ...createViewState({ manualValue: undefined }),
    inputSource: 'upstream' as const,
  }

  assert.equal(
    getDisplayedCapabilityInputViewState(
      historicalState,
      currentOverrideState,
      true,
    ).inputSource,
    'custom',
  )
})
