/* eslint-disable @typescript-eslint/no-require-imports -- Node runs these TypeScript tests directly. */
const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')

type Capability = import('@ihub/utils/types/campaign').Capability

const {
  getCapabilityPayloadVariables,
  resolveJsonSchemaReferences,
}: typeof import('./capabilitySchema') = require('./capabilitySchema.ts')

function createSchemaDocument(schemas: Record<string, unknown>) {
  return { components: { schemas }, $defs: schemas }
}

test('resolves direct, chained, nested, array, union, and $defs references', () => {
  const definitions = {
    Envelope: { $ref: '#/components/schemas/Payload' },
    Payload: {
      type: 'object',
      properties: {
        nested: { $ref: '#/$defs/Nested' },
        samples: {
          type: 'array',
          items: { $ref: '#/components/schemas/Sample' },
        },
        choice: {
          anyOf: [{ type: 'null' }, { $ref: '#/components/schemas/Sample' }],
        },
      },
    },
    Nested: { type: 'string' },
    Sample: { type: 'number' },
  }

  assert.deepEqual(
    resolveJsonSchemaReferences(
      { $ref: '#/components/schemas/Envelope' },
      createSchemaDocument(definitions),
    ),
    {
      type: 'object',
      properties: {
        nested: { type: 'string' },
        samples: { type: 'array', items: { type: 'number' } },
        choice: { anyOf: [{ type: 'null' }, { type: 'number' }] },
      },
    },
  )
})

test('decodes JSON Pointer names and lets reference siblings override definitions', () => {
  assert.deepEqual(
    resolveJsonSchemaReferences(
      {
        $ref: '#/components/schemas/Reading~1latest~0value',
        title: 'Latest reading',
      },
      createSchemaDocument({
        'Reading/latest~value': {
          type: 'number',
          title: 'Original reading',
        },
      }),
    ),
    { type: 'number', title: 'Latest reading' },
  )
})

test('resolves nested object, escaped, and array JSON Pointer segments', () => {
  const schemaDocument = {
    components: {
      schemas: {
        Outer: {
          properties: {
            inner: { type: 'number' },
            'path/with~tilde': { type: 'string' },
          },
        },
        Tuple: {
          prefixItems: [{ type: 'integer' }, { type: 'boolean' }],
        },
      },
    },
  }

  assert.deepEqual(
    resolveJsonSchemaReferences(
      {
        type: 'object',
        properties: {
          nested: {
            $ref: '#/components/schemas/Outer/properties/inner',
          },
          escaped: {
            $ref: '#/components/schemas/Outer/properties/path~1with~0tilde',
          },
          indexed: {
            $ref: '#/components/schemas/Tuple/prefixItems/1',
          },
        },
      },
      schemaDocument,
    ),
    {
      type: 'object',
      properties: {
        nested: { type: 'number' },
        escaped: { type: 'string' },
        indexed: { type: 'boolean' },
      },
    },
  )
})

test('preserves unresolved and cyclic references as finite JSON boundaries', () => {
  const definitions = {
    Direct: {
      type: 'object',
      properties: {
        child: { $ref: '#/components/schemas/Direct' },
      },
    },
    First: { $ref: '#/components/schemas/Second' },
    Second: { $ref: '#/components/schemas/First' },
  }
  const resolved = resolveJsonSchemaReferences(
    {
      type: 'object',
      properties: {
        direct: { $ref: '#/components/schemas/Direct' },
        indirect: { $ref: '#/components/schemas/First' },
        missing: { $ref: '#/components/schemas/Missing' },
      },
    },
    createSchemaDocument(definitions),
  )

  assert.deepEqual(resolved, {
    type: 'object',
    properties: {
      direct: {
        type: 'object',
        properties: {
          child: { $ref: '#/components/schemas/Direct' },
        },
      },
      indirect: { $ref: '#/components/schemas/First' },
      missing: { $ref: '#/components/schemas/Missing' },
    },
  })
  assert.doesNotThrow(() => JSON.stringify(resolved))
})

test('returns new objects without mutating the source schema or definitions', () => {
  const source = {
    type: 'object',
    properties: { reading: { $ref: '#/components/schemas/Reading' } },
  }
  const definitions = { Reading: { type: 'number' } }
  const originalSource = structuredClone(source)
  const schemaDocument = createSchemaDocument(definitions)
  const originalSchemaDocument = structuredClone(schemaDocument)
  const resolved = resolveJsonSchemaReferences(source, schemaDocument)

  assert.deepEqual(source, originalSource)
  assert.deepEqual(schemaDocument, originalSchemaDocument)
  assert.notEqual(resolved, source)
  assert.notEqual((resolved as typeof source).properties, source.properties)
})

test('does not invent fields for unresolved or cyclic root payloads', () => {
  const capability = {
    endpoints_schema: {
      endpoints: {},
      description: '',
      components: {
        schemas: {
          First: { $ref: '#/components/schemas/Second' },
          Second: { $ref: '#/components/schemas/First' },
        },
      },
    },
  }
  const capabilityMetadata = capability as unknown as Pick<
    Capability,
    'endpoints_schema'
  >

  assert.deepEqual(
    getCapabilityPayloadVariables(
      { $ref: '#/components/schemas/Missing' },
      capabilityMetadata,
    ),
    [],
  )
  assert.deepEqual(
    getCapabilityPayloadVariables(
      { $ref: '#/components/schemas/First' },
      capabilityMetadata,
    ),
    [],
  )
})

test('exposes a referenced open-ended object at its declared input path', () => {
  const capability = {
    endpoints_schema: {
      components: {
        schemas: {
          Settings: {
            type: 'object',
            title: 'Runtime settings',
            description: 'Arbitrary runtime configuration.',
            additionalProperties: { type: 'string' },
          },
        },
      },
    },
  } as unknown as Pick<Capability, 'endpoints_schema'>

  assert.deepEqual(
    getCapabilityPayloadVariables(
      {
        type: 'object',
        properties: {
          settings: { $ref: '#/components/schemas/Settings' },
        },
      },
      capability,
    ),
    [
      {
        title: 'Runtime settings',
        type: 'object',
        path: 'settings',
        description: 'Arbitrary runtime configuration.',
      },
    ],
  )
})

test('derives Random Number Generator inputs and outputs from referenced payloads', () => {
  const capability = {
    endpoints_schema: {
      endpoints: {
        generate_random_list: {
          subscribe: {
            message: {
              payload: {
                $ref: '#/components/schemas/RandomListSettings',
              },
            },
          },
        },
        generate_random_number: {
          subscribe: {
            message: {
              payload: { $ref: '#/components/schemas/RandomSettings' },
            },
          },
          publish: {
            message: {
              payload: { $ref: '#/components/schemas/RandomNumber' },
            },
          },
        },
      },
      description: '',
      components: {
        schemas: {
          RandomSettings: {
            type: 'object',
            properties: {
              seed: {
                anyOf: [{ type: 'integer' }, { type: 'null' }],
                default: null,
              },
              stream_id: { type: 'string', default: 'default' },
              delay: { type: 'number', default: 0 },
            },
          },
          RandomListSettings: {
            $ref: '#/components/schemas/RandomSettings',
            properties: {
              seed: {
                anyOf: [{ type: 'integer' }, { type: 'null' }],
                default: null,
              },
              stream_id: { type: 'string', default: 'default' },
              delay: { type: 'number', default: 0 },
              count: { type: 'integer', default: 1 },
            },
          },
          RandomNumber: {
            type: 'object',
            properties: {
              value: { title: 'Value', type: 'number' },
            },
          },
        },
      },
    },
  }
  const capabilityMetadata = capability as unknown as Pick<
    Capability,
    'endpoints_schema'
  >

  assert.deepEqual(
    getCapabilityPayloadVariables(
      capability.endpoints_schema.endpoints.generate_random_list.subscribe
        .message.payload,
      capabilityMetadata,
    ).map(({ path, type, default: defaultValue }) => ({
      path,
      type,
      default: defaultValue,
    })),
    [
      { path: 'seed', type: 'integer | null', default: null },
      { path: 'stream_id', type: 'string', default: 'default' },
      { path: 'delay', type: 'number', default: 0 },
      { path: 'count', type: 'integer', default: 1 },
    ],
  )
  assert.deepEqual(
    getCapabilityPayloadVariables(
      capability.endpoints_schema.endpoints.generate_random_number.subscribe
        .message.payload,
      capabilityMetadata,
    ).map(({ path, type, default: defaultValue }) => ({
      path,
      type,
      default: defaultValue,
    })),
    [
      { path: 'seed', type: 'integer | null', default: null },
      { path: 'stream_id', type: 'string', default: 'default' },
      { path: 'delay', type: 'number', default: 0 },
    ],
  )
  assert.deepEqual(
    getCapabilityPayloadVariables(
      capability.endpoints_schema.endpoints.generate_random_number.publish
        .message.payload,
      capabilityMetadata,
    ).map(({ path }) => path),
    ['value'],
  )
})
