/* eslint-disable @typescript-eslint/no-require-imports -- Node's direct TS test runner needs require() for sibling .ts files without changing package module settings. */
const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')

const visualizationNodeStatus =
  require('./VisualizationNodeStatus.ts') as typeof import('./VisualizationNodeStatus')

const {
  getVisualizationNodeStatus,
  getVisualizationNodeStatusUpdate,
  shouldShowVisualizationResolvingStatus,
} = visualizationNodeStatus

test('getVisualizationNodeStatus waits for a current run and mapped input', () => {
  assert.equal(
    getVisualizationNodeStatus({
      currentRunId: null,
      mappedInputCount: 1,
      phase: 'resolving',
    }),
    null,
  )
  assert.equal(
    getVisualizationNodeStatus({
      currentRunId: 'run-1',
      mappedInputCount: 0,
      phase: 'resolving',
    }),
    null,
  )
})

test('getVisualizationNodeStatus waits for mapped capability parents to complete', () => {
  assert.equal(
    getVisualizationNodeStatus({
      currentRunId: 'run-1',
      mappedInputCount: 1,
      phase: 'resolving',
      hasPendingCapabilityInputs: true,
    }),
    null,
  )
  assert.equal(
    getVisualizationNodeStatus({
      currentRunId: 'run-1',
      mappedInputCount: 1,
      phase: 'resolved',
      hasPendingCapabilityInputs: true,
    }),
    null,
  )
})

test('getVisualizationNodeStatus maps local resolution phases to badge statuses', () => {
  assert.equal(
    getVisualizationNodeStatus({
      currentRunId: 'run-1',
      mappedInputCount: 1,
      phase: 'resolving',
    }),
    'executing',
  )
  assert.equal(
    getVisualizationNodeStatus({
      currentRunId: 'run-1',
      mappedInputCount: 1,
      phase: 'resolved',
    }),
    'complete',
  )
  assert.equal(
    getVisualizationNodeStatus({
      currentRunId: 'run-1',
      mappedInputCount: 1,
      phase: 'failed',
    }),
    'error',
  )
})

test('getVisualizationNodeStatusUpdate clears stale visualization statuses', () => {
  assert.equal(
    getVisualizationNodeStatusUpdate({
      currentRunId: 'run-1',
      mappedInputCount: 0,
      phase: 'resolved',
    }),
    'idle',
  )
  assert.equal(
    getVisualizationNodeStatusUpdate({
      currentRunId: 'run-1',
      mappedInputCount: 1,
      phase: 'failed',
      hasPendingCapabilityInputs: true,
    }),
    'idle',
  )
})

test('getVisualizationNodeStatusUpdate preserves active visualization statuses', () => {
  assert.equal(
    getVisualizationNodeStatusUpdate({
      currentRunId: 'run-1',
      mappedInputCount: 1,
      phase: 'resolving',
    }),
    'executing',
  )
  assert.equal(
    getVisualizationNodeStatusUpdate({
      currentRunId: 'run-1',
      mappedInputCount: 1,
      phase: 'resolved',
    }),
    'complete',
  )
  assert.equal(
    getVisualizationNodeStatusUpdate({
      currentRunId: 'run-1',
      mappedInputCount: 1,
      phase: 'failed',
    }),
    'error',
  )
})

test('shouldShowVisualizationResolvingStatus only surfaces active campaign refreshes', () => {
  assert.equal(shouldShowVisualizationResolvingStatus('executing'), true)
  assert.equal(shouldShowVisualizationResolvingStatus('complete'), false)
  assert.equal(shouldShowVisualizationResolvingStatus('idle'), false)
})
