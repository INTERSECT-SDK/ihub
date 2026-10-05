/* eslint-disable @typescript-eslint/no-require-imports -- Node runs these TypeScript tests directly. */
const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')

import type {
  CampaignTask,
  CapabilityEventDefinition,
} from '@ihub/utils/types/campaign'

const { collectTaskOutputVariableGroups } =
  require('./taskOutputVariables.ts') as typeof import('./taskOutputVariables')

function createEventTask(
  eventDefinition?: CapabilityEventDefinition,
  overrides: Partial<CampaignTask> = {},
): CampaignTask {
  return {
    id: 'event-task-1234',
    hierarchy: 'event',
    capability: 'Sensor',
    operation_id: null,
    event_name: 'reading.changed',
    event_mode: 'once',
    output: null,
    input: null,
    task_dependencies: [],
    capability_metadata: {
      id: 'sensor-capability',
      name: 'Sensor capability',
      created_at: '',
      last_lifecycle_message: '',
      service_id: 1,
      endpoints_schema: {
        endpoints: {},
        events: eventDefinition ? { 'reading.changed': eventDefinition } : {},
        description: '',
      },
    },
    ...overrides,
  }
}

test('collects typed variables from a newly added wrapped Event payload', () => {
  const task = createEventTask({
    schemaFormat: 'application/json',
    payload: {
      type: 'object',
      properties: {
        acknowledged: { title: 'Acknowledged', type: 'boolean' },
        temperature: { title: 'Temperature', type: 'number' },
      },
    },
  })

  assert.deepEqual(collectTaskOutputVariableGroups([task]), [
    {
      taskId: 'event-task-1234',
      taskLabel: 'Sensor capability (reading.changed)',
      variables: [
        {
          path: 'acknowledged',
          label: 'Acknowledged (boolean)',
          valueType: 'boolean',
        },
        {
          path: 'temperature',
          label: 'Temperature (number)',
          valueType: 'number',
        },
      ],
    },
  ])
})

test('collects typed variables from a direct Event schema', () => {
  const task = createEventTask({
    type: 'object',
    properties: {
      nested: {
        type: 'object',
        properties: {
          count: { title: 'Count', type: 'integer' },
        },
      },
    },
  })

  assert.deepEqual(collectTaskOutputVariableGroups([task])[0]?.variables, [
    {
      path: 'nested.count',
      label: 'Count (integer)',
      valueType: 'integer',
    },
  ])
})

test('collects typed objective variables from a referenced Event schema', () => {
  const task = createEventTask({
    payload: {
      $ref: '#/components/schemas/EventEnvelope/properties/payload',
    },
  })
  task.capability_metadata!.endpoints_schema.components = {
    schemas: {
      EventEnvelope: {
        type: 'object',
        properties: {
          payload: {
            type: 'object',
            properties: {
              acknowledged: { title: 'Acknowledged', type: 'boolean' },
            },
          },
        },
      },
    },
  }

  assert.deepEqual(collectTaskOutputVariableGroups([task])[0]?.variables, [
    {
      path: 'acknowledged',
      label: 'Acknowledged (boolean)',
      valueType: 'boolean',
    },
  ])
})

test('collects a typed root scalar Event variable for objectives', () => {
  const task = createEventTask({ type: 'boolean' })

  assert.deepEqual(collectTaskOutputVariableGroups([task])[0]?.variables, [
    {
      path: 'value',
      label: 'value (boolean)',
      valueType: 'boolean',
    },
  ])
})

test('collects titled root array Event variables for objectives', () => {
  const task = createEventTask({
    type: 'array',
    title: 'samples',
    items: { type: 'number' },
  })

  assert.deepEqual(collectTaskOutputVariableGroups([task])[0]?.variables, [
    {
      path: 'samples',
      label: 'samples (number[])',
      valueType: 'number[]',
    },
  ])
})

test('falls back to the hydrated Event output schema', () => {
  const task = createEventTask(undefined, {
    capability_metadata: undefined,
    output: {
      schema: {
        type: 'object',
        properties: {
          ready: { title: 'Ready', type: 'boolean' },
        },
      },
      values: [],
    },
  })

  assert.deepEqual(collectTaskOutputVariableGroups([task])[0]?.variables, [
    { path: 'ready', label: 'Ready (boolean)', valueType: 'boolean' },
  ])
})

test('keeps Event schema metadata when fallback values duplicate its paths', () => {
  const task = createEventTask(
    {
      payload: {
        type: 'object',
        properties: {
          temperature: { title: 'Temperature', type: 'number' },
        },
      },
    },
    {
      output: {
        schema: {},
        values: [
          { id: 'duplicate', var: 'temperature' },
          { id: 'legacy', var: 'legacy_value' },
        ],
      },
    },
  )

  assert.deepEqual(collectTaskOutputVariableGroups([task])[0]?.variables, [
    {
      path: 'temperature',
      label: 'Temperature (number)',
      valueType: 'number',
    },
    {
      path: 'legacy_value',
      label: 'legacy_value',
      valueType: null,
    },
  ])
})

test('omits Events with no schema fields or fallback values', () => {
  assert.deepEqual(collectTaskOutputVariableGroups([createEventTask()]), [])
})

test('preserves ordinary capability output collection order and metadata', () => {
  const task: CampaignTask = {
    id: 'capability-task-1234',
    hierarchy: 'capability',
    capability: 'Calculator',
    operation_id: 'calculate',
    output: {
      schema: {},
      values: [
        { id: 'fallback', var: 'result' },
        { id: 'legacy', var: 'legacy_value' },
      ],
    },
    input: null,
    task_dependencies: [],
    endpoint_channel: {
      publish: {
        message: {
          schemaFormat: 'application/json',
          contentType: 'application/json',
          traits: { $ref: '' },
          payload: {
            type: 'object',
            title: 'Output',
            properties: {
              result: { title: 'Result', type: 'number' },
              succeeded: { title: 'Succeeded', type: 'boolean' },
            },
          },
        },
        description: '',
      },
      subscribe: {
        message: {
          schemaFormat: 'application/json',
          contentType: 'application/json',
          traits: { $ref: '' },
          payload: { type: 'object', title: 'Input' },
        },
        description: '',
      },
      events: [],
    },
  }

  assert.deepEqual(collectTaskOutputVariableGroups([task]), [
    {
      taskId: 'capability-task-1234',
      taskLabel: 'Calculator (calculate)',
      variables: [
        { path: 'result', label: 'result', valueType: null },
        { path: 'legacy_value', label: 'legacy_value', valueType: null },
        {
          path: 'succeeded',
          label: 'Succeeded (boolean)',
          valueType: 'boolean',
        },
      ],
    },
  ])
})

test('collects referenced capability outputs for objectives and visualizations', () => {
  const task: CampaignTask = {
    id: 'capability-task-1234',
    hierarchy: 'capability',
    capability: 'Random Number Generator',
    operation_id: 'generate_random_number',
    output: null,
    input: null,
    task_dependencies: [],
    capability_metadata: {
      id: 'random-capability',
      name: 'Random Number Generator',
      created_at: '',
      last_lifecycle_message: '',
      service_id: 1,
      endpoints_schema: {
        endpoints: {},
        description: '',
        components: {
          schemas: {
            RandomNumber: {
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
          schemaFormat: 'application/json',
          contentType: 'application/json',
          traits: { $ref: '' },
          payload: {
            type: 'object',
            title: 'Output',
            $ref: '#/components/schemas/RandomNumber',
          },
        },
        description: '',
      },
      subscribe: {
        message: {
          schemaFormat: 'application/json',
          contentType: 'application/json',
          traits: { $ref: '' },
          payload: { type: 'object', title: 'Input' },
        },
        description: '',
      },
      events: [],
    },
  }

  assert.deepEqual(collectTaskOutputVariableGroups([task])[0]?.variables, [
    {
      path: 'value',
      label: 'Value (number)',
      valueType: 'number',
    },
  ])
})
