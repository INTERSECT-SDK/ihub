import assert from 'node:assert/strict'
import test from 'node:test'

import { getStatusBadgeColor } from './status-badge.ts'

test('maps healthy statuses to green', () => {
  assert.equal(getStatusBadgeColor('connected'), 'green')
  assert.equal(getStatusBadgeColor('online'), 'green')
})

test('maps warning statuses to yellow', () => {
  assert.equal(getStatusBadgeColor('stale'), 'yellow')
  assert.equal(getStatusBadgeColor('warning'), 'yellow')
})

test('maps offline statuses to red', () => {
  assert.equal(getStatusBadgeColor('offline'), 'red')
  assert.equal(getStatusBadgeColor('disconnected'), 'red')
  assert.equal(getStatusBadgeColor('failed'), 'red')
})

test('maps transitional and unknown statuses to gray', () => {
  assert.equal(getStatusBadgeColor('connecting'), 'gray')
  assert.equal(getStatusBadgeColor('interrupted'), 'gray')
  assert.equal(getStatusBadgeColor('unavailable'), 'gray')
  assert.equal(getStatusBadgeColor('other'), 'gray')
})
