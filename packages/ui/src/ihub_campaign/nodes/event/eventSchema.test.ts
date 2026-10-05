/* eslint-disable @typescript-eslint/no-require-imports -- Node runs these TypeScript tests directly. */
const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')

const {
  getEventRootOutputName,
  normalizeEventPayloadSchema,
  normalizeEventSettings,
} = require('./eventSchema.ts') as typeof import('./eventSchema')

function createSchemaDocument(schemas: Record<string, unknown>) {
  return { components: { schemas }, $defs: schemas }
}

test('normalizes wrapped and direct event payload schemas', () => {
  const payload = {
    type: 'object',
    properties: { temperature: { type: 'number' } },
  }
  assert.deepEqual(
    normalizeEventPayloadSchema({ payload, schemaFormat: 'json' }),
    payload,
  )
  assert.deepEqual(normalizeEventPayloadSchema(payload), payload)
})

test('resolves direct, wrapped, chained, and nested component references', () => {
  const definitions = {
    EventPayload: { $ref: '#/components/schemas/EventFields' },
    EventFields: {
      type: 'object',
      properties: {
        reading: { $ref: '#/components/schemas/Reading' },
      },
    },
    Reading: { type: 'number', title: 'Reading' },
  }
  const expected = {
    type: 'object',
    properties: {
      reading: { type: 'number', title: 'Reading' },
    },
  }

  assert.deepEqual(
    normalizeEventPayloadSchema(
      { $ref: '#/components/schemas/EventPayload' },
      createSchemaDocument(definitions),
    ),
    expected,
  )
  assert.deepEqual(
    normalizeEventPayloadSchema(
      { payload: { $ref: '#/components/schemas/EventPayload' } },
      createSchemaDocument(definitions),
    ),
    expected,
  )
  assert.deepEqual(
    normalizeEventPayloadSchema(
      { $ref: '#/$defs/EventFields' },
      createSchemaDocument(definitions),
    ),
    expected,
  )
})

test('merges reference siblings over the resolved event schema', () => {
  assert.deepEqual(
    normalizeEventPayloadSchema(
      {
        payload: {
          $ref: '#/components/schemas/Reading',
          title: 'Current reading',
        },
      },
      createSchemaDocument({
        Reading: { type: 'number', title: 'Original title' },
      }),
    ),
    {
      type: 'object',
      properties: {
        'Current reading': { type: 'number', title: 'Current reading' },
      },
    },
  )
})

test('leaves unresolved and cyclic root references non-selectable', () => {
  assert.deepEqual(
    normalizeEventPayloadSchema({ $ref: '#/components/schemas/Missing' }, {}),
    {},
  )
  assert.deepEqual(
    normalizeEventPayloadSchema(
      { $ref: '#/components/schemas/First' },
      createSchemaDocument({
        First: { $ref: '#/components/schemas/Second' },
        Second: { $ref: '#/components/schemas/First' },
      }),
    ),
    {},
  )
})

test('normalizes root scalar event payloads with backend-compatible names', () => {
  assert.deepEqual(normalizeEventPayloadSchema({ type: 'integer' }), {
    type: 'object',
    properties: { value: { type: 'integer' } },
  })
  assert.deepEqual(
    normalizeEventPayloadSchema({ type: 'string', title: 'message' }),
    {
      type: 'object',
      properties: {
        message: { type: 'string', title: 'message' },
      },
    },
  )
  assert.equal(getEventRootOutputName({ type: 'integer' }), 'value')
  assert.equal(
    getEventRootOutputName({ type: 'string', title: 'message' }),
    'message',
  )
})

test('normalizes root enum and const payloads', () => {
  assert.deepEqual(normalizeEventPayloadSchema({ enum: ['ready', 'busy'] }), {
    type: 'object',
    properties: { value: { enum: ['ready', 'busy'] } },
  })
  assert.deepEqual(
    normalizeEventPayloadSchema({ const: 7, title: 'statusCode' }),
    {
      type: 'object',
      properties: { statusCode: { const: 7, title: 'statusCode' } },
    },
  )
})

test('selects the first non-null root union branch', () => {
  const definition = {
    anyOf: [
      { type: 'null' },
      { type: 'number', title: 'reading' },
      { type: 'string', title: 'ignored' },
    ],
  }

  assert.deepEqual(normalizeEventPayloadSchema(definition), {
    type: 'object',
    properties: {
      reading: { type: 'number', title: 'reading' },
    },
  })
  assert.equal(getEventRootOutputName(definition), 'reading')
})

test('normalizes primitive and object root arrays as whole values', () => {
  assert.deepEqual(
    normalizeEventPayloadSchema({
      type: 'array',
      title: 'samples',
      items: { type: 'number' },
    }),
    {
      type: 'object',
      properties: {
        samples: {
          type: 'array',
          title: 'samples',
          items: { type: 'number' },
        },
      },
    },
  )
  assert.deepEqual(
    normalizeEventPayloadSchema({
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'integer' } },
      },
    }),
    {
      type: 'object',
      properties: {
        value: {
          type: 'array',
          items: {
            type: 'object',
            properties: { id: { type: 'integer' } },
          },
        },
      },
    },
  )
})

test('omits null-only root event payloads', () => {
  const definition = { oneOf: [{ type: 'null' }] }

  assert.deepEqual(normalizeEventPayloadSchema(definition), {})
  assert.equal(getEventRootOutputName(definition), null)
  assert.deepEqual(normalizeEventPayloadSchema({}), {})
  assert.equal(getEventRootOutputName({ title: 'metadata only' }), null)
})

test('normalizes count settings and clears counts from other modes', () => {
  assert.deepEqual(normalizeEventSettings('count', 0), {
    event_mode: 'count',
    event_count: 1,
  })
  assert.deepEqual(normalizeEventSettings('persistent', 4), {
    event_mode: 'persistent',
    event_count: null,
  })
})
