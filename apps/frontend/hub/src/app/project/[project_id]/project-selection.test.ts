import assert from 'node:assert/strict'
import test from 'node:test'

import {
  clearDepartingProjectSelection,
  normalizeProjectRouteId,
} from './project-selection.ts'

test('normalizes a valid project route identifier', () => {
  assert.equal(normalizeProjectRouteId(' project-123 '), 'project-123')
})

test('rejects missing, blank, ambiguous, and invalid project routes', () => {
  assert.equal(normalizeProjectRouteId(undefined), undefined)
  assert.equal(normalizeProjectRouteId('  '), undefined)
  assert.equal(normalizeProjectRouteId(['project-a', 'project-b']), undefined)
  assert.equal(normalizeProjectRouteId('undefined'), undefined)
})

test('clears the selection when its project layout exits', () => {
  assert.equal(
    clearDepartingProjectSelection('project-a', 'project-a'),
    undefined,
  )
})

test('preserves a newer project selection during stale cleanup', () => {
  assert.equal(
    clearDepartingProjectSelection('project-b', 'project-a'),
    'project-b',
  )
})
