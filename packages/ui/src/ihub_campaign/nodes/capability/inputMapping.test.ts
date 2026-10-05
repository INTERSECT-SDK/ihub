/* eslint-disable @typescript-eslint/no-require-imports -- Node's direct TS test runner needs require() for focused sibling modules. */
const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')

const {
  dataMappingsAreEqual,
  getManualInputValues,
  getSelectedUpstreamValueForTarget,
  parseManualInputValue,
  removeMappingsForTargetParameter,
  upsertMappingForTargetParameter,
} = require('./inputMapping.ts') as typeof import('./inputMapping')

test('getManualInputValues returns saved values and a stable empty fallback', () => {
  const manualInputValues = { 'payload.temperature': 42 }

  assert.equal(
    getManualInputValues({
      id: 'target-node',
      data: { manualInputValues },
    }),
    manualInputValues,
  )
  assert.equal(getManualInputValues(undefined), getManualInputValues(undefined))
})

test('parseManualInputValue preserves current manual input parsing behavior', () => {
  assert.equal(parseManualInputValue(''), undefined)
  assert.equal(parseManualInputValue('42'), 42)
  assert.equal(parseManualInputValue('3.14'), 3.14)
  assert.equal(parseManualInputValue('sample'), 'sample')
})

test('dataMappingsAreEqual detects unchanged mappings', () => {
  const mapping = {
    source_parameter: 'result.value',
    target_parameter: 'payload.value',
  }

  assert.equal(dataMappingsAreEqual([mapping], [mapping]), true)
  assert.equal(
    dataMappingsAreEqual(
      [mapping],
      [{ ...mapping, source_parameter: 'other' }],
    ),
    false,
  )
})

test('removeMappingsForTargetParameter clears only the requested target input', () => {
  const mappings = [
    {
      source_parameter: 'result.temperature',
      target_parameter: 'payload.temperature',
    },
    {
      source_parameter: 'result.pressure',
      target_parameter: 'payload.pressure',
    },
  ]

  assert.deepEqual(
    removeMappingsForTargetParameter(mappings, 'payload.temperature'),
    [
      {
        source_parameter: 'result.pressure',
        target_parameter: 'payload.pressure',
      },
    ],
  )
  assert.deepEqual(mappings.length, 2)
})

test('upsertMappingForTargetParameter returns unchanged output for an identical mapping', () => {
  const mappings = [
    {
      source_parameter: 'result.temperature',
      target_parameter: 'payload.temperature',
    },
    {
      source_parameter: 'result.pressure',
      target_parameter: 'payload.pressure',
    },
  ]

  assert.equal(
    upsertMappingForTargetParameter(mappings, {
      source_parameter: 'result.temperature',
      target_parameter: 'payload.temperature',
    }),
    mappings,
  )
})

test('upsertMappingForTargetParameter replaces an existing target in place', () => {
  const mappings = [
    {
      source_parameter: 'result.temperature',
      target_parameter: 'payload.temperature',
    },
    {
      source_parameter: 'result.pressure',
      target_parameter: 'payload.pressure',
    },
  ]

  assert.deepEqual(
    upsertMappingForTargetParameter(mappings, {
      source_parameter: 'result.humidity',
      target_parameter: 'payload.temperature',
    }),
    [
      {
        source_parameter: 'result.humidity',
        target_parameter: 'payload.temperature',
      },
      {
        source_parameter: 'result.pressure',
        target_parameter: 'payload.pressure',
      },
    ],
  )
  assert.deepEqual(mappings[0], {
    source_parameter: 'result.temperature',
    target_parameter: 'payload.temperature',
  })
})

test('upsertMappingForTargetParameter appends a missing target mapping', () => {
  const mappings = [
    {
      source_parameter: 'result.temperature',
      target_parameter: 'payload.temperature',
    },
  ]

  assert.deepEqual(
    upsertMappingForTargetParameter(mappings, {
      source_parameter: 'result.pressure',
      target_parameter: 'payload.pressure',
    }),
    [
      {
        source_parameter: 'result.temperature',
        target_parameter: 'payload.temperature',
      },
      {
        source_parameter: 'result.pressure',
        target_parameter: 'payload.pressure',
      },
    ],
  )
})

test('upsertMappingForTargetParameter collapses duplicate target mappings', () => {
  const mappings = [
    {
      source_parameter: 'result.temperature',
      target_parameter: 'payload.temperature',
    },
    {
      source_parameter: 'result.pressure',
      target_parameter: 'payload.pressure',
    },
    {
      source_parameter: 'result.humidity',
      target_parameter: 'payload.temperature',
    },
  ]

  assert.deepEqual(
    upsertMappingForTargetParameter(mappings, {
      source_parameter: 'result.wind',
      target_parameter: 'payload.temperature',
    }),
    [
      {
        source_parameter: 'result.wind',
        target_parameter: 'payload.temperature',
      },
      {
        source_parameter: 'result.pressure',
        target_parameter: 'payload.pressure',
      },
    ],
  )
})

test('upsertMappingForTargetParameter keeps shared source mappings stable', () => {
  const firstUpdate = upsertMappingForTargetParameter([], {
    source_parameter: 'result.value',
    target_parameter: 'payload.primary',
  })
  const secondUpdate = upsertMappingForTargetParameter(firstUpdate, {
    source_parameter: 'result.value',
    target_parameter: 'payload.secondary',
  })

  assert.deepEqual(secondUpdate, [
    {
      source_parameter: 'result.value',
      target_parameter: 'payload.primary',
    },
    {
      source_parameter: 'result.value',
      target_parameter: 'payload.secondary',
    },
  ])
  assert.equal(
    upsertMappingForTargetParameter(secondUpdate, {
      source_parameter: 'result.value',
      target_parameter: 'payload.secondary',
    }),
    secondUpdate,
  )
})

test('getSelectedUpstreamValueForTarget reads the active incoming edge mapping', () => {
  assert.equal(
    getSelectedUpstreamValueForTarget(
      [
        {
          id: 'edge-1',
          source: 'source-a',
          target: 'target',
          data: {
            data_mapping: [
              {
                source_parameter: 'result.temperature',
                target_parameter: 'payload.temperature',
              },
            ],
          },
        },
        {
          id: 'edge-2',
          source: 'source-b',
          target: 'target',
          data: {
            data_mapping: [
              {
                source_parameter: 'result.pressure',
                target_parameter: 'payload.pressure',
              },
            ],
          },
        },
      ],
      'target',
      'payload.pressure',
    ),
    'source-b:::result.pressure',
  )
})

test('getSelectedUpstreamValueForTarget restores an empty JSON root pointer', () => {
  const edges = [
    {
      id: 'json-edge',
      source: 'json-source',
      target: 'target',
      data: {
        data_mapping: [
          {
            source_parameter: '',
            target_parameter: 'payload',
          },
        ],
      },
    },
  ]

  assert.equal(
    getSelectedUpstreamValueForTarget(edges, 'target', 'payload'),
    'json-source:::',
  )
  assert.equal(
    getSelectedUpstreamValueForTarget(edges, 'target', 'missing'),
    null,
  )
})

test('getSelectedUpstreamValueForTarget skips incomplete persisted mappings', () => {
  const edges = [
    {
      id: 'null-source-edge',
      source: 'incomplete-null-source',
      target: 'target',
      data: {
        data_mapping: [
          {
            source_parameter: null,
            target_parameter: 'payload',
          },
        ],
      },
    },
    {
      id: 'missing-source-edge',
      source: 'incomplete-missing-source',
      target: 'target',
      data: {
        data_mapping: [
          {
            target_parameter: 'payload',
          },
        ],
      },
    },
    {
      id: 'valid-edge',
      source: 'valid-source',
      target: 'target',
      data: {
        data_mapping: [
          {
            source_parameter: 'result.value',
            target_parameter: 'payload',
          },
        ],
      },
    },
  ] as unknown as Parameters<typeof getSelectedUpstreamValueForTarget>[0]

  assert.equal(
    getSelectedUpstreamValueForTarget(edges, 'target', 'payload'),
    'valid-source:::result.value',
  )
})
