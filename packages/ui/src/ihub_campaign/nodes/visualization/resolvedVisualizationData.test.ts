/* eslint-disable @typescript-eslint/no-require-imports -- Node directly executes focused TypeScript tests in this package. */
const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')

const { getCompletedOutputIteration, getVisibleResolvedVisualizationData } =
  require('./resolvedVisualizationData.ts') as typeof import('./resolvedVisualizationData')

test('hides delayed persisted output resolved for an older run', () => {
  assert.deepEqual(
    getVisibleResolvedVisualizationData(
      { runId: 'run-a', data: { values: [1, 2] } },
      'run-b',
    ),
    {},
  )
})

test('shows persisted output only for its matching displayed run', () => {
  const data = { values: [1, 2] }
  assert.equal(
    getVisibleResolvedVisualizationData({ runId: 'run-a', data }, 'run-a'),
    data,
  )
})

test('keeps literal and code-node previews run independent', () => {
  const data = { literal: 'preview', codeValues: [3, 4] }
  assert.equal(
    getVisibleResolvedVisualizationData({ runId: null, data }, 'run-b'),
    data,
  )
})

test('identifies the iteration that produced a displayed output', () => {
  assert.equal(getCompletedOutputIteration('complete', 3), 3)
  assert.equal(getCompletedOutputIteration('executing', 3), 2)
  assert.equal(getCompletedOutputIteration('executing', 1), 1)
  assert.equal(getCompletedOutputIteration('waiting', 0), null)
})
