/* eslint-disable @typescript-eslint/no-require-imports -- Node's direct TS runner needs require() for sibling modules. */
const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')

const {
  resolvePersistedEventPayloadValue,
}: typeof import('./persistedEventPayload') = require('./persistedEventPayload.ts')

test('resolves root scalar and array Event payloads as whole values', () => {
  assert.equal(
    resolvePersistedEventPayloadValue('42', 'value', { type: 'integer' }),
    42,
  )
  assert.deepEqual(
    resolvePersistedEventPayloadValue('[1,2,3]', 'samples', {
      type: 'array',
      title: 'samples',
      items: { type: 'integer' },
    }),
    [1, 2, 3],
  )
})

test('preserves top-level object field resolution', () => {
  assert.equal(
    resolvePersistedEventPayloadValue('{"temperature":21.5}', 'temperature', {
      type: 'object',
      properties: { temperature: { type: 'number' } },
    }),
    21.5,
  )
})

test('resolves persisted values using referenced Event schemas', () => {
  assert.equal(
    resolvePersistedEventPayloadValue(
      '42',
      'reading',
      { payload: { $ref: '#/components/schemas/Reading' } },
      {
        components: {
          schemas: { Reading: { type: 'number', title: 'reading' } },
        },
      },
    ),
    42,
  )
})

test('returns undefined for mismatched paths and payload shapes', () => {
  assert.equal(
    resolvePersistedEventPayloadValue('42', 'other', { type: 'integer' }),
    undefined,
  )
  assert.equal(
    resolvePersistedEventPayloadValue('42', 'temperature', {
      type: 'object',
      properties: { temperature: { type: 'number' } },
    }),
    undefined,
  )
  assert.equal(
    resolvePersistedEventPayloadValue('{"value":42}', 'value', {
      type: 'integer',
    }),
    undefined,
  )
})

test('rejects malformed persisted Event payload JSON', () => {
  assert.throws(() =>
    resolvePersistedEventPayloadValue('{invalid', 'value', {
      type: 'integer',
    }),
  )
})
