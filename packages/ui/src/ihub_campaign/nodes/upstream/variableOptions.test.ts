/* eslint-disable @typescript-eslint/no-require-imports -- Node's direct TS test runner needs require() for focused sibling modules. */
const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')

const {
  buildPotentialOptions,
  buildUpstreamOptionValue,
  buildUpstreamVariableOptions,
  comboboxDataHasEnabledOption,
  getUpstreamOptionCompatibility,
  isCompatibleUpstreamOptionValue,
  normalizeVariableType,
  variableTypesAreCompatible,
} = require('./variableOptions.ts') as typeof import('./variableOptions')

test('buildUpstreamVariableOptions groups parent outputs without mutating inputs', () => {
  const parentsOutputItems = {
    capabilityParent: [
      {
        title: 'Temperature',
        type: 'number',
        path: 'result.temperature',
      },
    ],
    codeParent: [
      {
        title: 'frame',
        type: 'DataFrame',
        path: 'frame',
      },
    ],
    unknownParent: [
      {
        title: 'fallback',
        type: 'string',
        path: 'fallback.value',
      },
    ],
  }
  const nodes = [
    {
      id: 'capabilityParent',
      type: 'capability',
      data: { endpoint: 'measure' },
    },
    {
      id: 'codeParent',
      type: 'code',
      data: { name: 'Notebook Prep' },
    },
  ]

  assert.deepEqual(buildUpstreamVariableOptions(parentsOutputItems, nodes), [
    {
      group: 'From measure (capabilityParent)',
      items: [
        {
          value: buildUpstreamOptionValue(
            'capabilityParent',
            'result.temperature',
          ),
          label: 'Temperature (number)',
          disabled: false,
        },
      ],
    },
    {
      group: 'From Notebook Prep (codeParent)',
      items: [
        {
          value: buildUpstreamOptionValue('codeParent', 'frame'),
          label: 'frame (DataFrame)',
          disabled: false,
        },
      ],
    },
    {
      group: 'From unknownParent (unknownParent)',
      items: [
        {
          value: buildUpstreamOptionValue('unknownParent', 'fallback.value'),
          label: 'fallback (string)',
          disabled: false,
        },
      ],
    },
  ])
  assert.deepEqual(
    parentsOutputItems.capabilityParent?.[0]?.path,
    'result.temperature',
  )
})

test('labels JSON file output groups with the persisted project-relative path', () => {
  assert.deepEqual(
    buildUpstreamVariableOptions(
      {
        jsonSource: [
          { title: 'sample › count', type: 'integer', path: '/sample/count' },
        ],
      },
      [
        {
          id: 'jsonSource',
          type: 'json-file',
          data: {
            name: 'values.json',
            fileReference: { path: 'inputs/values.json' },
          },
        },
      ],
    ),
    [
      {
        group: 'From inputs/values.json (jsonSource)',
        items: [
          {
            value: buildUpstreamOptionValue('jsonSource', '/sample/count'),
            label: 'sample › count (integer)',
            disabled: false,
          },
        ],
      },
    ],
  )
})

test('normalizeVariableType makes schema labels comparable', () => {
  assert.equal(normalizeVariableType(' Number '), 'number')
  assert.equal(normalizeVariableType('STRING []'), 'string[]')
})

test('normalizeVariableType tolerates missing runtime schema types', () => {
  assert.equal(normalizeVariableType(undefined), '')
  assert.equal(normalizeVariableType(null), '')
})

test('variableTypesAreCompatible accepts exact normalized matches', () => {
  assert.equal(variableTypesAreCompatible('String', ' string '), true)
  assert.equal(variableTypesAreCompatible('DataFrame', 'dataframe'), true)
})

test('variableTypesAreCompatible treats integer and number as compatible primitives', () => {
  assert.equal(variableTypesAreCompatible('integer', 'number'), true)
  assert.equal(variableTypesAreCompatible('number', 'integer'), true)
})

test('variableTypesAreCompatible maps Python primitive aliases before comparison', () => {
  assert.equal(variableTypesAreCompatible('int', 'integer'), true)
  assert.equal(variableTypesAreCompatible('float', 'number'), true)
  assert.equal(variableTypesAreCompatible('str', 'string'), true)
  assert.equal(variableTypesAreCompatible('bool', 'boolean'), true)
  assert.equal(variableTypesAreCompatible('dict', 'object'), true)
  assert.equal(variableTypesAreCompatible('NoneType', 'null'), true)
  assert.equal(variableTypesAreCompatible('list', 'object'), false)
  assert.equal(variableTypesAreCompatible('tuple', 'object'), false)
})

test('variableTypesAreCompatible rejects incompatible primitive types', () => {
  assert.equal(variableTypesAreCompatible('string', 'number'), false)
  assert.equal(variableTypesAreCompatible('boolean', 'integer'), false)
  assert.equal(variableTypesAreCompatible('int', 'string'), false)
  assert.equal(variableTypesAreCompatible('bool', 'integer'), false)
  assert.equal(variableTypesAreCompatible(undefined, 'integer'), false)
  assert.equal(variableTypesAreCompatible('integer', undefined), false)
})

test('variableTypesAreCompatible accepts numeric array type matches', () => {
  assert.equal(variableTypesAreCompatible('string[]', 'string[]'), true)
  assert.equal(variableTypesAreCompatible('integer[]', 'integer[]'), true)
  assert.equal(variableTypesAreCompatible('integer[]', 'number[]'), true)
  assert.equal(variableTypesAreCompatible('number[]', 'integer[]'), true)
  assert.equal(variableTypesAreCompatible('int[]', 'number[]'), true)
  assert.equal(variableTypesAreCompatible('float[]', 'integer[]'), true)
  assert.equal(variableTypesAreCompatible('list', 'integer[]'), false)
  assert.equal(variableTypesAreCompatible('list', 'number[]'), false)
  assert.equal(variableTypesAreCompatible('string[]', 'number[]'), false)
  assert.equal(variableTypesAreCompatible('string[]', 'string'), false)
  assert.equal(variableTypesAreCompatible('number[]', 'number'), false)
})

test('variableTypesAreCompatible accepts source unions only when every branch matches', () => {
  assert.equal(variableTypesAreCompatible('integer | null', 'integer'), false)
  assert.equal(variableTypesAreCompatible('integer', 'integer | null'), true)
  assert.equal(
    variableTypesAreCompatible('integer[] | string[]', 'number[]'),
    false,
  )
  assert.equal(
    variableTypesAreCompatible('integer[]', 'number[] | string[]'),
    true,
  )
})

test('variableTypesAreCompatible accepts scalar values in broad target union type labels', () => {
  const scalarArrayObjectUnion =
    'string | integer | number | boolean | null | string[] | integer[] | number[] | boolean[] | null[] | object'

  assert.equal(
    variableTypesAreCompatible('integer[]', scalarArrayObjectUnion),
    true,
  )
  assert.equal(
    variableTypesAreCompatible('number', scalarArrayObjectUnion),
    true,
  )
  assert.equal(
    variableTypesAreCompatible('DataFrame', scalarArrayObjectUnion),
    false,
  )
})

test('variableTypesAreCompatible maps Python aliases inside union type labels', () => {
  assert.equal(variableTypesAreCompatible('int | str', 'integer'), false)
  assert.equal(variableTypesAreCompatible('float | bool', 'boolean'), false)
  assert.equal(variableTypesAreCompatible('DataFrame | str', 'string'), false)
  assert.equal(variableTypesAreCompatible('dict | NoneType', 'object'), false)
  assert.equal(
    variableTypesAreCompatible('dict | NoneType', 'object | null'),
    true,
  )
  assert.equal(variableTypesAreCompatible('list | DataFrame', 'object'), false)
})

test('comboboxDataHasEnabledOption detects ungrouped enabled options', () => {
  assert.equal(comboboxDataHasEnabledOption([]), false)
  assert.equal(
    comboboxDataHasEnabledOption([
      { value: 'disabled', label: 'Disabled', disabled: true },
    ]),
    false,
  )
  assert.equal(
    comboboxDataHasEnabledOption([
      { value: 'disabled', label: 'Disabled', disabled: true },
      { value: 'enabled', label: 'Enabled' },
    ]),
    true,
  )
})

test('comboboxDataHasEnabledOption detects grouped enabled options', () => {
  assert.equal(
    comboboxDataHasEnabledOption([
      {
        group: 'Disabled group',
        items: [
          { value: 'one', label: 'One', disabled: true },
          { value: 'two', label: 'Two', disabled: true },
        ],
      },
    ]),
    false,
  )
  assert.equal(
    comboboxDataHasEnabledOption([
      {
        group: 'Disabled group',
        items: [{ value: 'one', label: 'One', disabled: true }],
      },
      {
        group: 'Enabled group',
        items: [{ value: 'two', label: 'Two' }],
      },
    ]),
    true,
  )
})

test('variableTypesAreCompatible requires exact custom runtime type matches', () => {
  assert.equal(variableTypesAreCompatible('DataFrame', 'DataFrame'), true)
  assert.equal(variableTypesAreCompatible('DataFrame', 'Series'), false)
})

test('buildPotentialOptions disables upstream fields incompatible with the target input', () => {
  const parentsOutputItems = {
    sourceNode: [
      {
        title: 'Temperature',
        type: 'number',
        path: 'result.temperature',
      },
      {
        title: 'Sample Name',
        type: 'string',
        path: 'result.sample_name',
      },
    ],
  }
  const nodes = [
    {
      id: 'sourceNode',
      type: 'capability',
      data: { endpoint: 'measure' },
    },
  ]
  const targetInput = {
    title: 'Temperature Input',
    type: 'number',
    path: 'payload.temperature',
  }

  assert.deepEqual(
    buildPotentialOptions(parentsOutputItems, nodes, targetInput),
    [
      {
        group: 'From measure (sourceNode)',
        items: [
          {
            value: buildUpstreamOptionValue('sourceNode', 'result.temperature'),
            label: 'Temperature (number)',
            disabled: false,
          },
          {
            value: buildUpstreamOptionValue('sourceNode', 'result.sample_name'),
            label: 'Sample Name (string)',
            disabled: true,
          },
        ],
      },
    ],
  )
})

test('buildPotentialOptions disables missing-type fields without crashing', () => {
  const parentsOutputItems = {
    sourceNode: [
      {
        title: 'Untyped Result',
        path: 'result.untyped',
      },
    ],
  } as unknown as Record<
    string,
    Array<{
      title: string
      type: string
      path: string
    }>
  >
  const nodes = [
    {
      id: 'sourceNode',
      type: 'capability',
      data: { endpoint: 'measure' },
    },
  ]

  assert.deepEqual(
    buildPotentialOptions(parentsOutputItems, nodes, {
      title: 'Temperature Input',
      type: 'number',
      path: 'payload.temperature',
    }),
    [
      {
        group: 'From measure (sourceNode)',
        items: [
          {
            value: buildUpstreamOptionValue('sourceNode', 'result.untyped'),
            label: 'Untyped Result (undefined)',
            disabled: true,
          },
        ],
      },
    ],
  )
})

test('buildPotentialOptions enables array outputs accepted by union target inputs', () => {
  const parentsOutputItems = {
    sourceNode: [
      {
        title: 'Value',
        type: 'integer[]',
        path: 'value',
      },
      {
        title: 'Frame',
        type: 'DataFrame',
        path: 'frame',
      },
    ],
  }
  const nodes = [
    {
      id: 'sourceNode',
      type: 'capability',
      data: { endpoint: 'make-values' },
    },
  ]

  assert.deepEqual(
    buildPotentialOptions(parentsOutputItems, nodes, {
      title: 'content',
      type: 'string | integer | number | boolean | null | string[] | integer[] | number[] | boolean[] | null[] | object',
      path: 'content',
    }),
    [
      {
        group: 'From make-values (sourceNode)',
        items: [
          {
            value: buildUpstreamOptionValue('sourceNode', 'value'),
            label: 'Value (integer[])',
            disabled: false,
          },
          {
            value: buildUpstreamOptionValue('sourceNode', 'frame'),
            label: 'Frame (DataFrame)',
            disabled: true,
          },
        ],
      },
    ],
  )
})

test('buildPotentialOptions preserves numeric alias compatibility in both directions', () => {
  const parentsOutputItems = {
    sourceNode: [
      {
        title: 'Count',
        type: 'integer',
        path: 'result.count',
      },
      {
        title: 'Ratio',
        type: 'number',
        path: 'result.ratio',
      },
    ],
  }
  const nodes = [
    {
      id: 'sourceNode',
      type: 'capability',
      data: { endpoint: 'measure' },
    },
  ]

  assert.deepEqual(
    buildPotentialOptions(parentsOutputItems, nodes, {
      title: 'Number Input',
      type: 'number',
      path: 'payload.number',
    }),
    [
      {
        group: 'From measure (sourceNode)',
        items: [
          {
            value: buildUpstreamOptionValue('sourceNode', 'result.count'),
            label: 'Count (integer)',
            disabled: false,
          },
          {
            value: buildUpstreamOptionValue('sourceNode', 'result.ratio'),
            label: 'Ratio (number)',
            disabled: false,
          },
        ],
      },
    ],
  )

  assert.deepEqual(
    buildPotentialOptions(parentsOutputItems, nodes, {
      title: 'Integer Input',
      type: 'integer',
      path: 'payload.integer',
    }),
    [
      {
        group: 'From measure (sourceNode)',
        items: [
          {
            value: buildUpstreamOptionValue('sourceNode', 'result.count'),
            label: 'Count (integer)',
            disabled: false,
          },
          {
            value: buildUpstreamOptionValue('sourceNode', 'result.ratio'),
            label: 'Ratio (number)',
            disabled: false,
          },
        ],
      },
    ],
  )
})

test('buildPotentialOptions enables code-node numeric array aliases for numeric array inputs', () => {
  const parentsOutputItems = {
    sourceNode: [
      {
        title: 'Values',
        type: 'integer[]',
        path: 'result.values',
      },
      {
        title: 'Names',
        type: 'string[]',
        path: 'result.names',
      },
      {
        title: 'Raw List',
        type: 'list',
        path: 'result.raw_list',
      },
    ],
  }
  const nodes = [
    {
      id: 'sourceNode',
      type: 'code',
      data: { name: 'Notebook Prep' },
    },
  ]

  assert.deepEqual(
    buildPotentialOptions(parentsOutputItems, nodes, {
      title: 'Values Input',
      type: 'number[]',
      path: 'payload.values',
    }),
    [
      {
        group: 'From Notebook Prep (sourceNode)',
        items: [
          {
            value: buildUpstreamOptionValue('sourceNode', 'result.values'),
            label: 'Values (integer[])',
            disabled: false,
          },
          {
            value: buildUpstreamOptionValue('sourceNode', 'result.names'),
            label: 'Names (string[])',
            disabled: true,
          },
          {
            value: buildUpstreamOptionValue('sourceNode', 'result.raw_list'),
            label: 'Raw List (list)',
            disabled: true,
          },
        ],
      },
    ],
  )
})

test('buildPotentialOptions enables Python primitive runtime aliases accepted by target inputs', () => {
  const parentsOutputItems = {
    sourceNode: [
      {
        title: 'Count',
        type: 'int',
        path: 'result.count',
      },
      {
        title: 'Ratio',
        type: 'float',
        path: 'result.ratio',
      },
      {
        title: 'Name',
        type: 'str',
        path: 'result.name',
      },
      {
        title: 'Ready',
        type: 'bool',
        path: 'result.ready',
      },
    ],
  }
  const nodes = [
    {
      id: 'sourceNode',
      type: 'code',
      data: { name: 'Notebook Prep' },
    },
  ]

  assert.deepEqual(
    buildPotentialOptions(parentsOutputItems, nodes, {
      title: 'Name Input',
      type: 'string',
      path: 'payload.name',
    }),
    [
      {
        group: 'From Notebook Prep (sourceNode)',
        items: [
          {
            value: buildUpstreamOptionValue('sourceNode', 'result.count'),
            label: 'Count (int)',
            disabled: true,
          },
          {
            value: buildUpstreamOptionValue('sourceNode', 'result.ratio'),
            label: 'Ratio (float)',
            disabled: true,
          },
          {
            value: buildUpstreamOptionValue('sourceNode', 'result.name'),
            label: 'Name (str)',
            disabled: false,
          },
          {
            value: buildUpstreamOptionValue('sourceNode', 'result.ready'),
            label: 'Ready (bool)',
            disabled: true,
          },
        ],
      },
    ],
  )
})

test('isCompatibleUpstreamOptionValue rejects selections the hook must not persist', () => {
  const parentsOutputItems = {
    sourceNode: [
      {
        title: 'Temperature',
        type: 'number',
        path: 'result.temperature',
      },
      {
        title: 'Sample Name',
        type: 'string',
        path: 'result.sample_name',
      },
    ],
  }
  const targetInput = {
    title: 'Temperature Input',
    type: 'number',
    path: 'payload.temperature',
  }

  assert.equal(
    isCompatibleUpstreamOptionValue({
      value: buildUpstreamOptionValue('sourceNode', 'result.temperature'),
      targetInput,
      parentsOutputItems,
    }),
    true,
  )
  assert.equal(
    isCompatibleUpstreamOptionValue({
      value: buildUpstreamOptionValue('sourceNode', 'result.sample_name'),
      targetInput,
      parentsOutputItems,
    }),
    false,
  )
  assert.equal(
    isCompatibleUpstreamOptionValue({
      value: buildUpstreamOptionValue('missingNode', 'result.temperature'),
      targetInput,
      parentsOutputItems,
    }),
    false,
  )
})

test('getUpstreamOptionCompatibility distinguishes incompatible from unresolved selections', () => {
  const parentsOutputItems = {
    sourceNode: [
      {
        title: 'Temperature',
        type: 'number',
        path: 'result.temperature',
      },
      {
        title: 'Sample Name',
        type: 'string',
        path: 'result.sample_name',
      },
    ],
  }
  const targetInput = {
    title: 'Temperature Input',
    type: 'number',
    path: 'payload.temperature',
  }

  assert.equal(
    getUpstreamOptionCompatibility({
      value: buildUpstreamOptionValue('sourceNode', 'result.temperature'),
      targetInput,
      parentsOutputItems,
    }),
    'compatible',
  )
  assert.equal(
    getUpstreamOptionCompatibility({
      value: buildUpstreamOptionValue('sourceNode', 'result.sample_name'),
      targetInput,
      parentsOutputItems,
    }),
    'incompatible',
  )
  assert.equal(
    getUpstreamOptionCompatibility({
      value: buildUpstreamOptionValue('missingNode', 'result.temperature'),
      targetInput,
      parentsOutputItems,
    }),
    'unresolved',
  )
  assert.equal(
    getUpstreamOptionCompatibility({
      value: buildUpstreamOptionValue('sourceNode', 'result.missing'),
      targetInput,
      parentsOutputItems,
    }),
    'unresolved',
  )
})

test('buildPotentialOptions reuses upstream variable option behavior', () => {
  const parentsOutputItems = {
    sourceNode: [
      {
        title: 'Temperature',
        type: 'number',
        path: 'result.temperature',
      },
    ],
  }
  const nodes = [
    {
      id: 'sourceNode',
      type: 'capability',
      data: { endpoint: 'measure' },
    },
  ]

  assert.deepEqual(
    buildPotentialOptions(parentsOutputItems, nodes),
    buildUpstreamVariableOptions(parentsOutputItems, nodes),
  )
})
