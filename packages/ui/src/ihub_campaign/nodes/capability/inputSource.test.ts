/* eslint-disable @typescript-eslint/no-require-imports -- Node's direct TS test runner needs require() for focused sibling modules. */
const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')

const { getCapabilityInputSourceMode, getSegmentedControlActiveIndex } =
  require('./inputSource.ts') as typeof import('./inputSource')

test('getCapabilityInputSourceMode restores upstream mappings before manual values', () => {
  assert.equal(
    getCapabilityInputSourceMode({
      selectedUpstreamValue: 'source:::result.value',
      manualInputValues: { 'payload.value': 10 },
      inputPath: 'payload.value',
      hasUpstreamOptions: true,
    }),
    'upstream',
  )

  assert.equal(
    getCapabilityInputSourceMode({
      selectedUpstreamValue: 'source:::result.value',
      manualInputValues: { 'payload.value': 10 },
      inputPath: 'payload.value',
      hasUpstreamOptions: false,
    }),
    'upstream',
  )
})

test('getCapabilityInputSourceMode restores saved manual values without active mappings', () => {
  assert.equal(
    getCapabilityInputSourceMode({
      selectedUpstreamValue: null,
      manualInputValues: { 'payload.value': 10 },
      inputPath: 'payload.value',
      hasUpstreamOptions: true,
    }),
    'custom',
  )
})

test('getCapabilityInputSourceMode preserves explicit source override without mappings', () => {
  assert.equal(
    getCapabilityInputSourceMode({
      selectedUpstreamValue: null,
      manualInputValues: { 'payload.value': 10 },
      inputPath: 'payload.value',
      hasUpstreamOptions: true,
      userInputSourceOverride: 'upstream',
    }),
    'upstream',
  )
})

test('getCapabilityInputSourceMode preserves Custom without a manual value', () => {
  assert.equal(
    getCapabilityInputSourceMode({
      selectedUpstreamValue: null,
      inputPath: 'payload.value',
      hasUpstreamOptions: true,
      userInputSourceOverride: 'custom',
    }),
    'custom',
  )
})

test('getCapabilityInputSourceMode preserves Upstream without a mapping', () => {
  assert.equal(
    getCapabilityInputSourceMode({
      selectedUpstreamValue: null,
      manualInputValues: { 'payload.value': 10 },
      inputPath: 'payload.value',
      hasUpstreamOptions: true,
      userInputSourceOverride: 'upstream',
    }),
    'upstream',
  )
})

test('getCapabilityInputSourceMode lets restored mappings override custom source', () => {
  assert.equal(
    getCapabilityInputSourceMode({
      selectedUpstreamValue: 'source:::result.value',
      manualInputValues: { 'payload.value': 10 },
      inputPath: 'payload.value',
      hasUpstreamOptions: true,
      userInputSourceOverride: 'custom',
    }),
    'upstream',
  )
})

test('getCapabilityInputSourceMode defaults by available upstream options', () => {
  assert.equal(
    getCapabilityInputSourceMode({
      selectedUpstreamValue: null,
      inputPath: 'payload.value',
      hasUpstreamOptions: true,
    }),
    'upstream',
  )
  assert.equal(
    getCapabilityInputSourceMode({
      selectedUpstreamValue: null,
      inputPath: 'payload.value',
      hasUpstreamOptions: false,
    }),
    'custom',
  )
})

test('getSegmentedControlActiveIndex maps selected values to option indexes', () => {
  assert.equal(
    getSegmentedControlActiveIndex(
      [{ value: 'upstream' }, { value: 'custom' }, { value: 'default' }],
      'custom',
    ),
    1,
  )
})

test('getSegmentedControlActiveIndex falls back to the first option for missing values', () => {
  assert.equal(
    getSegmentedControlActiveIndex(
      [{ value: 'upstream' }, { value: 'custom' }],
      'missing',
    ),
    0,
  )
})

test('getSegmentedControlActiveIndex returns a safe fallback for empty options', () => {
  assert.equal(getSegmentedControlActiveIndex([], 'missing'), 0)
})
