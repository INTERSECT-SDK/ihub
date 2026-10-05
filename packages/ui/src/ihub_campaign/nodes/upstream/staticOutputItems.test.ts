/* eslint-disable @typescript-eslint/no-require-imports -- Node's direct TS runner needs require() for sibling modules. */
const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')

const {
  buildStaticUpstreamOutputItems,
}: typeof import('./staticOutputItems') = require('./staticOutputItems.ts')

const sourceNodes = [
  {
    id: 'capability-source',
    type: 'capability',
    data: {
      endpoint_channel: {
        publish: {
          message: {
            payload: {
              type: 'object',
              properties: {
                result: { title: 'Result', type: 'number' },
              },
            },
          },
        },
      },
    },
  },
  {
    id: 'json-source',
    type: 'json-file',
    data: {
      manifest: [
        { pointer: '', displayName: '$', type: 'object' },
        {
          pointer: '/temperature',
          displayName: 'temperature',
          type: 'number',
        },
      ],
    },
  },
]

test('includes JSON file outputs for capability consumers by default', () => {
  assert.deepEqual(buildStaticUpstreamOutputItems(sourceNodes), {
    'capability-source': [
      {
        title: 'Result',
        type: 'number',
        path: 'result',
        description: undefined,
        default: undefined,
      },
    ],
    'json-source': [
      { title: '$', type: 'object', path: '', description: undefined },
      {
        title: 'temperature',
        type: 'number',
        path: '/temperature',
        description: undefined,
      },
    ],
  })
})

test('excludes JSON file outputs for visualization consumers', () => {
  assert.deepEqual(buildStaticUpstreamOutputItems(sourceNodes, false), {
    'capability-source': [
      {
        title: 'Result',
        type: 'number',
        path: 'result',
        description: undefined,
        default: undefined,
      },
    ],
  })
})

test('exposes wrapped event payload fields as upstream outputs', () => {
  const outputs = buildStaticUpstreamOutputItems([
    {
      id: 'event-source',
      type: 'event',
      data: {
        event_schema: {
          payload: {
            type: 'object',
            properties: {
              temperature: { title: 'Temperature', type: 'number' },
            },
          },
        },
      },
    },
  ])

  assert.deepEqual(outputs['event-source'], [
    {
      title: 'Temperature',
      type: 'number',
      path: 'temperature',
      description: undefined,
      default: undefined,
    },
  ])
})

test('exposes referenced event payload fields as upstream outputs', () => {
  const outputs = buildStaticUpstreamOutputItems([
    {
      id: 'event-source',
      type: 'event',
      data: {
        capability: {
          endpoints_schema: {
            components: {
              schemas: {
                EventPayload: {
                  type: 'object',
                  properties: {
                    progress: { title: 'Progress', type: 'number' },
                  },
                },
              },
            },
          },
        },
        event_schema: {
          payload: { $ref: '#/components/schemas/EventPayload' },
        },
      },
    },
  ])

  assert.deepEqual(outputs['event-source'], [
    {
      title: 'Progress',
      type: 'number',
      path: 'progress',
      description: undefined,
      default: undefined,
    },
  ])
})

test('exposes referenced capability publish fields as upstream outputs', () => {
  const outputs = buildStaticUpstreamOutputItems([
    {
      id: 'capability-source',
      type: 'capability',
      data: {
        capability: {
          endpoints_schema: {
            components: {
              schemas: {
                Result: {
                  type: 'object',
                  properties: {
                    value: { title: 'Value', type: 'number' },
                  },
                },
              },
            },
          },
        },
        endpoint_channel: {
          publish: {
            message: {
              payload: { $ref: '#/components/schemas/Result' },
            },
          },
        },
      },
    },
  ])

  assert.deepEqual(outputs['capability-source'], [
    {
      title: 'Value',
      type: 'number',
      path: 'value',
      description: undefined,
      default: undefined,
    },
  ])
})

test('exposes root scalar and array events with non-empty output paths', () => {
  const outputs = buildStaticUpstreamOutputItems([
    {
      id: 'scalar-event',
      type: 'event',
      data: { event_schema: { type: 'integer' } },
    },
    {
      id: 'array-event',
      type: 'event',
      data: {
        event_schema: {
          type: 'array',
          title: 'samples',
          items: { type: 'object' },
        },
      },
    },
  ])

  assert.deepEqual(outputs['scalar-event'], [
    {
      title: 'value',
      type: 'integer',
      path: 'value',
      description: undefined,
      default: undefined,
    },
  ])
  assert.deepEqual(outputs['array-event'], [
    {
      title: 'samples',
      type: 'object[]',
      path: 'samples',
      description: undefined,
    },
  ])
})
