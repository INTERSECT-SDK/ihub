/* eslint-disable @typescript-eslint/no-require-imports -- Node's direct TS test runner loads the dependency-free action helpers. */
const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')
const {
  cancelNodeAction,
  confirmNodeAction,
  requestNodeAction,
}: typeof import('./nodeActions') = require('./nodeActions.ts')

test('delete requests confirmation and cancel does not invoke deletion', () => {
  let deletionCount = 0
  const deleteAction = {
    id: 'delete',
    label: 'Delete',
    tooltip: 'Delete node',
    icon: null,
    confirmation: {
      prompt: 'Delete node?',
      confirmLabel: 'Confirm delete',
      cancelLabel: 'Cancel delete',
      onConfirm: () => {
        deletionCount += 1
      },
    },
  }

  assert.equal(requestNodeAction(deleteAction), 'delete')
  assert.equal(deletionCount, 0)
  assert.equal(cancelNodeAction(), null)
  assert.equal(deletionCount, 0)
})

test('confirm invokes the pending deletion exactly once', () => {
  let deletionCount = 0
  const deleteAction = {
    id: 'delete',
    label: 'Delete',
    tooltip: 'Delete node',
    icon: null,
    confirmation: {
      prompt: 'Delete node?',
      confirmLabel: 'Confirm delete',
      cancelLabel: 'Cancel delete',
      onConfirm: () => {
        deletionCount += 1
      },
    },
  }

  const nextState = confirmNodeAction(
    [deleteAction],
    requestNodeAction(deleteAction),
  )

  assert.equal(nextState, null)
  assert.equal(deletionCount, 1)
})

test('disabled actions do not run or enter confirmation', () => {
  let selectionCount = 0
  const disabledAction = {
    id: 'run',
    label: 'Run',
    tooltip: 'Action unavailable',
    icon: null,
    disabled: true,
    onSelect: () => {
      selectionCount += 1
    },
  }

  assert.equal(requestNodeAction(disabledAction), null)
  assert.equal(selectionCount, 0)
})

test('a confirmation cannot apply after its action becomes disabled', () => {
  let confirmations = 0
  const action = {
    id: 'delete',
    label: 'Delete',
    tooltip: 'Delete',
    icon: null,
    disabled: true,
    confirmation: {
      prompt: 'Delete?',
      confirmLabel: 'Confirm',
      cancelLabel: 'Cancel',
      onConfirm: () => {
        confirmations += 1
      },
    },
  }

  assert.equal(confirmNodeAction([action], 'delete'), null)
  assert.equal(confirmations, 0)
})
