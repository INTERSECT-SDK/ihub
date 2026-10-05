import assert from 'node:assert/strict'
import test from 'node:test'

import { isBrokerListCacheKey } from './broker-list-cache-key.ts'

test('matches unscoped and project-scoped broker-list keys', () => {
  assert.equal(isBrokerListCacheKey('/api/v1/brokers'), true)
  assert.equal(
    isBrokerListCacheKey('/api/v1/brokers?project_id=project-123'),
    true,
  )
  assert.equal(
    isBrokerListCacheKey('/api/v1/brokers?project_id=project-123&limit=25'),
    true,
  )
})

test('excludes broker detail and action keys', () => {
  assert.equal(isBrokerListCacheKey('/api/v1/brokers/1'), false)
  assert.equal(isBrokerListCacheKey('/api/v1/brokers/connect/1'), false)
  assert.equal(isBrokerListCacheKey('/api/v1/brokers/disconnect/1'), false)
})

test('excludes unrelated and non-string keys', () => {
  assert.equal(isBrokerListCacheKey('/api/v1/brokers-extra'), false)
  assert.equal(isBrokerListCacheKey('/api/v1/projects'), false)
  assert.equal(isBrokerListCacheKey(['/api/v1/brokers']), false)
  assert.equal(isBrokerListCacheKey(undefined), false)
})
