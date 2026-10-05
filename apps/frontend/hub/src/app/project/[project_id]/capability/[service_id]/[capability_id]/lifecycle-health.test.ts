import assert from 'node:assert/strict'
import test from 'node:test'

import { formatLifecycleTimestamp } from './lifecycle-health.ts'

test('formats lifecycle timestamps with explicit timezone context', () => {
  assert.match(
    formatLifecycleTimestamp('2026-09-26T16:05:06Z', 'en-US', 'UTC'),
    /Sep 26, 2026, 4:05:06 PM UTC/,
  )
  assert.match(
    formatLifecycleTimestamp('2026-09-26T16:05:06', 'en-US', 'UTC'),
    /Sep 26, 2026, 4:05:06 PM UTC/,
  )
})

test('uses unavailable for missing and invalid lifecycle timestamps', () => {
  assert.equal(formatLifecycleTimestamp(null), 'Unavailable')
  assert.equal(formatLifecycleTimestamp('not-a-date'), 'Unavailable')
})
