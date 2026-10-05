/* eslint-disable @typescript-eslint/no-require-imports -- Node's direct TS test runner needs require() for the sibling .ts helper without changing package module settings. */
const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')
const {
  spawnSync,
}: typeof import('node:child_process') = require('node:child_process')

const { PYTHON_RUNTIME_TYPE_CLASSIFIER, getVariablesFromNode } =
  require('./helpers.ts') as typeof import('./helpers')

const pythonSpawnOptions = { encoding: 'utf8' } as const

function runPythonScript(
  script: string,
): import('node:child_process').SpawnSyncReturns<string> {
  let result = spawnSync('python3', ['-c', script], pythonSpawnOptions)

  if (
    result.error &&
    'code' in result.error &&
    result.error.code === 'ENOENT'
  ) {
    result = spawnSync('python', ['-c', script], pythonSpawnOptions)
  }

  return result
}

function pythonUnavailable(
  result: import('node:child_process').SpawnSyncReturns<string>,
) {
  return (
    result.error && 'code' in result.error && result.error.code === 'ENOENT'
  )
}

test('getVariablesFromNode summarizes scalar array object anyOf fields', () => {
  assert.deepEqual(
    getVariablesFromNode({
      type: 'object',
      properties: {
        content: {
          anyOf: [
            {
              anyOf: [
                { type: 'string' },
                { type: 'integer' },
                { type: 'number' },
                { type: 'boolean' },
                { type: 'null' },
              ],
            },
            {
              items: {
                anyOf: [
                  { type: 'string' },
                  { type: 'integer' },
                  { type: 'number' },
                  { type: 'boolean' },
                  { type: 'null' },
                ],
              },
              type: 'array',
            },
            {
              additionalProperties: {
                anyOf: [
                  { type: 'string' },
                  { type: 'integer' },
                  { type: 'number' },
                  { type: 'boolean' },
                  { type: 'null' },
                ],
              },
              type: 'object',
            },
          ],
        },
      },
    }),
    [
      {
        title: 'content',
        type: 'string | integer | number | boolean | null | string[] | integer[] | number[] | boolean[] | null[] | object',
        description: undefined,
        path: 'content',
        default: undefined,
      },
    ],
  )
})

test('getVariablesFromNode treats arrays of objects as one mapped value', () => {
  assert.deepEqual(
    getVariablesFromNode({
      type: 'object',
      properties: {
        samples: {
          type: 'array',
          items: {
            type: 'object',
            properties: { id: { type: 'integer' } },
          },
        },
      },
    }),
    [
      {
        title: 'samples',
        type: 'object[]',
        path: 'samples',
        description: undefined,
      },
    ],
  )
})

test('getVariablesFromNode exposes open-ended objects as whole values', () => {
  assert.deepEqual(
    getVariablesFromNode({
      type: 'object',
      properties: {
        unconstrained: {
          type: 'object',
          title: 'Unconstrained settings',
          description: 'Settings with arbitrary keys.',
          additionalProperties: true,
        },
        stringValues: {
          type: 'object',
          title: 'String settings',
          description: 'Settings whose values are strings.',
          additionalProperties: { type: 'string' },
        },
      },
    }),
    [
      {
        title: 'Unconstrained settings',
        type: 'object',
        path: 'unconstrained',
        description: 'Settings with arbitrary keys.',
      },
      {
        title: 'String settings',
        type: 'object',
        path: 'stringValues',
        description: 'Settings whose values are strings.',
      },
    ],
  )
})

test('getVariablesFromNode does not overlap mixed open-object mappings', () => {
  assert.deepEqual(
    getVariablesFromNode({
      type: 'object',
      properties: {
        settings: {
          type: 'object',
          properties: {
            known: { type: 'number' },
          },
          additionalProperties: true,
        },
      },
    }),
    [
      {
        title: 'settings',
        type: 'object',
        path: 'settings',
        description: undefined,
      },
    ],
  )
})

test('getVariablesFromNode keeps fixed objects expanded', () => {
  assert.deepEqual(
    getVariablesFromNode({
      type: 'object',
      properties: {
        implicit: {
          type: 'object',
          properties: { count: { type: 'integer' } },
        },
        explicit: {
          type: 'object',
          properties: { enabled: { type: 'boolean' } },
          additionalProperties: false,
        },
      },
    }),
    [
      {
        title: 'implicit.count',
        type: 'integer',
        description: undefined,
        path: 'implicit.count',
        default: undefined,
      },
      {
        title: 'explicit.enabled',
        type: 'boolean',
        description: undefined,
        path: 'explicit.enabled',
        default: undefined,
      },
    ],
  )
})

test('getVariablesFromNode does not create an empty-path open-object input', () => {
  assert.deepEqual(
    getVariablesFromNode({
      type: 'object',
      additionalProperties: true,
    }),
    [],
  )
})

test('python runtime classifier source keeps bool checks before int checks', () => {
  assert.match(
    PYTHON_RUNTIME_TYPE_CLASSIFIER,
    /if isinstance\(val, bool\):[\s\S]*if isinstance\(val, int\):/,
  )
})

test('python runtime classifier labels homogeneous primitive lists strictly', (t) => {
  const script = `
import json

${PYTHON_RUNTIME_TYPE_CLASSIFIER}

class CustomValue:
    pass

print(json.dumps({
    "integers": _ihub_runtime_type_label([1, 2, 3]),
    "numbers": _ihub_runtime_type_label([1.0, 2.5]),
    "strings": _ihub_runtime_type_label(["a", "b"]),
    "booleans": _ihub_runtime_type_label([True, False]),
    "nulls": _ihub_runtime_type_label([None, None]),
    "empty": _ihub_runtime_type_label([]),
    "mixed": _ihub_runtime_type_label([1, "b"]),
    "custom": _ihub_runtime_type_label(CustomValue()),
    "customList": _ihub_runtime_type_label([CustomValue(), CustomValue()]),
    "nestedList": _ihub_runtime_type_label([[1], [2]]),
}))
`

  const result = runPythonScript(script)

  if (pythonUnavailable(result)) {
    t.skip('python unavailable')
    return
  }

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), {
    integers: 'integer[]',
    numbers: 'number[]',
    strings: 'string[]',
    booleans: 'boolean[]',
    nulls: 'null[]',
    empty: 'list',
    mixed: 'list',
    custom: 'CustomValue',
    customList: 'list',
    nestedList: 'list',
  })
})

test('python runtime classifier samples list prefixes without full traversal', (t) => {
  const script = `
import json

${PYTHON_RUNTIME_TYPE_CLASSIFIER}

class CountingList(list):
    def __iter__(self):
        for index, item in enumerate(super().__iter__(), start=1):
            if index > _IHUB_LIST_SAMPLE_SIZE:
                raise AssertionError("iterated past sample")
            yield item

values = CountingList([*range(_IHUB_LIST_SAMPLE_SIZE), "after sample"])

print(json.dumps({
    "label": _ihub_runtime_type_label(values),
}))
`

  const result = runPythonScript(script)

  if (pythonUnavailable(result)) {
    t.skip('python unavailable')
    return
  }

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), {
    label: 'integer[]',
  })
})
