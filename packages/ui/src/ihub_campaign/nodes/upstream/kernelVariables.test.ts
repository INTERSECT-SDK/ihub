/* eslint-disable @typescript-eslint/no-require-imports -- Node's direct TS test runner needs require() for focused sibling modules. */
const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')

const { kernelVariablesToVariableItems } =
  require('./kernelVariables.ts') as typeof import('./kernelVariables')

test('kernelVariablesToVariableItems converts variable maps to selectable items', () => {
  assert.deepEqual(
    kernelVariablesToVariableItems({
      frame: 'DataFrame',
      values: 'integer[]',
      count: 3,
    }),
    [
      {
        title: 'frame',
        type: 'DataFrame',
        path: 'frame',
      },
      {
        title: 'values',
        type: 'integer[]',
        path: 'values',
      },
      {
        title: 'count',
        type: '3',
        path: 'count',
      },
    ],
  )
})
