import assert from 'node:assert/strict'
import test from 'node:test'

import {
  deriveOrchestratorHealthStatus,
  getOrchestratorHealthKey,
  parseOrchestratorHealthResponse,
  scheduleOrchestratorHealthRetry,
} from './orchestrator-health.ts'

test('schedules a health retry after 30 seconds with SWR retry options', () => {
  const retryOptions = { retryCount: 2, dedupe: true }
  let scheduledCallback: (() => void) | undefined
  let scheduledDelay: number | undefined
  let receivedOptions: typeof retryOptions | undefined

  scheduleOrchestratorHealthRetry(
    (options) => {
      receivedOptions = options
    },
    retryOptions,
    (callback, delay) => {
      scheduledCallback = callback
      scheduledDelay = delay
    },
  )

  assert.equal(scheduledDelay, 30_000)
  assert.equal(receivedOptions, undefined)

  scheduledCallback?.()

  assert.equal(receivedOptions, retryOptions)
})

test('disables health requests when no orchestrator URL is configured', () => {
  assert.equal(getOrchestratorHealthKey(1), null)
  assert.equal(getOrchestratorHealthKey(1, ''), null)
  assert.equal(getOrchestratorHealthKey(1, '   '), null)
})

test('health cache key contains the endpoint and current orchestrator URL', () => {
  assert.deepEqual(getOrchestratorHealthKey(7, 'http://orchestrator-one'), [
    '/api/v1/brokers/7/orchestrator-health',
    'http://orchestrator-one',
  ])
  assert.notDeepEqual(
    getOrchestratorHealthKey(7, 'http://orchestrator-one'),
    getOrchestratorHealthKey(7, 'http://orchestrator-two'),
  )
})

test('validates orchestrator health API responses', () => {
  assert.equal(
    parseOrchestratorHealthResponse({ status: 'connected' }),
    'connected',
  )
  assert.equal(
    parseOrchestratorHealthResponse({ status: 'disconnected' }),
    'disconnected',
  )
  assert.equal(
    parseOrchestratorHealthResponse({ status: 'not_configured' }),
    'not_configured',
  )
  assert.equal(parseOrchestratorHealthResponse({ status: 'checking' }), null)
  assert.equal(parseOrchestratorHealthResponse({}), null)
  assert.equal(parseOrchestratorHealthResponse(null), null)
})

test('derives not configured before request state', () => {
  assert.equal(
    deriveOrchestratorHealthStatus({ failed: false }),
    'not_configured',
  )
})

test('derives checking for a configured initial request', () => {
  assert.equal(
    deriveOrchestratorHealthStatus({
      orchestratorUrl: 'http://orchestrator',
      failed: false,
    }),
    'checking',
  )
})

for (const status of ['connected', 'disconnected', 'not_configured'] as const) {
  test(`derives ${status} from a valid API response`, () => {
    assert.equal(
      deriveOrchestratorHealthStatus({
        orchestratorUrl: 'http://orchestrator',
        status,
        failed: false,
      }),
      status,
    )
  })
}

test('derives unavailable from a failed API request', () => {
  assert.equal(
    deriveOrchestratorHealthStatus({
      orchestratorUrl: 'http://orchestrator',
      failed: true,
    }),
    'unavailable',
  )
})

test('returns to the successful health status after an error clears', () => {
  const orchestratorUrl = 'http://orchestrator'

  assert.equal(
    deriveOrchestratorHealthStatus({
      orchestratorUrl,
      status: 'connected',
      failed: true,
    }),
    'unavailable',
  )
  assert.equal(
    deriveOrchestratorHealthStatus({
      orchestratorUrl,
      status: 'connected',
      failed: false,
    }),
    'connected',
  )
})
