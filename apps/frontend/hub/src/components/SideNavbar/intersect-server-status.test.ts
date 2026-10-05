import assert from 'node:assert/strict'
import test from 'node:test'

import { summarizeIntersectServerStatus } from './intersect-server-status.ts'

test('summarizes two connected components as connected', () => {
  assert.deepEqual(summarizeIntersectServerStatus('connected', 'connected'), {
    status: 'connected',
  })
})

test('summarizes two disconnected components as disconnected', () => {
  assert.deepEqual(
    summarizeIntersectServerStatus('disconnected', 'disconnected'),
    { status: 'disconnected' },
  )
})

test('warns when only the broker is disconnected', () => {
  assert.deepEqual(
    summarizeIntersectServerStatus('disconnected', 'connected'),
    {
      status: 'warning',
      tooltip: 'Broker: DISCONNECTED',
    },
  )
})

test('warns when only the orchestrator is disconnected', () => {
  assert.deepEqual(
    summarizeIntersectServerStatus('connected', 'disconnected'),
    {
      status: 'warning',
      tooltip: 'Orchestrator: DISCONNECTED',
    },
  )
})

for (const status of [
  'checking',
  'connecting',
  'failed',
  'not_configured',
  'unavailable',
]) {
  test(`warns and formats the ${status} state`, () => {
    assert.deepEqual(summarizeIntersectServerStatus('connected', status), {
      status: 'warning',
      tooltip: `Orchestrator: ${status.replaceAll('_', ' ').toUpperCase()}`,
    })
  })
}

test('warning details identify every non-connected component', () => {
  assert.deepEqual(summarizeIntersectServerStatus('failed', 'not_configured'), {
    status: 'warning',
    tooltip: 'Broker: FAILED, Orchestrator: NOT CONFIGURED',
  })
})
