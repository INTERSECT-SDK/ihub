import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getCapabilityStatus,
  getCapabilityStatusTooltip,
} from './lifecycle-health.ts'

const now = Date.parse('2026-09-26T16:00:00Z')

test('active lifecycle errors take precedence over connectivity and recency', () => {
  const capability = {
    last_lifecycle_message: '2026-09-26T15:59:00Z',
    lifecycle_error: 'The lifecycle advertisement could not be parsed.',
  }

  assert.equal(getCapabilityStatus(capability, 'connected', now), 'error')
  assert.equal(getCapabilityStatus(capability, 'disconnected', now), 'error')
  assert.equal(
    getCapabilityStatusTooltip('error', capability.lifecycle_error),
    capability.lifecycle_error,
  )
})

test('clearing an error restores existing lifecycle status rules', () => {
  assert.equal(
    getCapabilityStatus(
      {
        last_lifecycle_message: '2026-09-26T15:59:00Z',
        lifecycle_error: null,
      },
      'connected',
      now,
    ),
    'online',
  )
  assert.equal(
    getCapabilityStatus(
      {
        last_lifecycle_message: '2026-09-26T15:00:00Z',
        lifecycle_error: null,
      },
      'connected',
      now,
    ),
    'stale',
  )
  assert.equal(
    getCapabilityStatus(
      {
        last_lifecycle_message: '2026-09-26T15:59:00Z',
        lifecycle_error: null,
      },
      'disconnected',
      now,
    ),
    'offline',
  )
})
