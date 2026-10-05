import assert from 'node:assert/strict'
import test from 'node:test'

import {
  loadLauncherRegistry,
  type LauncherRegistryFetch,
} from './launcher-registry.ts'

test('loads every registry page for services, brokers, and capabilities', async () => {
  const signal = new AbortController().signal
  const requestedPages: string[] = []
  const firstPage = Array.from({ length: 100 }, (_, index) => index + 1)

  const fetcher: LauncherRegistryFetch = async (url, init) => {
    assert.equal(init?.signal, signal)
    requestedPages.push(url)

    const parsedUrl = new URL(url, 'http://localhost')
    const resource = parsedUrl.pathname.split('/').at(-1)
    const offset = Number(parsedUrl.searchParams.get('offset'))
    const ids = offset === 0 ? firstPage : [101]
    let records: unknown[]

    if (resource === 'services') {
      records = ids.map((id) => ({ id, broker_id: id }))
    } else if (resource === 'brokers') {
      records = ids.map((id) => ({
        id,
        label: `Broker ${id}`,
        status: 'connected',
      }))
    } else {
      records = ids.map((id) => ({
        id: `capability-${id}`,
        name: `Capability ${id}`,
        service_id: id,
      }))
    }

    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(records),
    }
  }

  const registry = await loadLauncherRegistry({ signal, fetcher })

  assert.deepEqual(requestedPages.sort(), [
    '/api/v1/brokers?offset=0&limit=100',
    '/api/v1/brokers?offset=100&limit=100',
    '/api/v1/capabilities?offset=0&limit=100',
    '/api/v1/capabilities?offset=100&limit=100',
    '/api/v1/services?offset=0&limit=100',
    '/api/v1/services?offset=100&limit=100',
  ])
  assert.deepEqual(registry.services.at(-1), { id: 101, broker_id: 101 })
  assert.deepEqual(registry.brokers.at(-1), {
    id: 101,
    label: 'Broker 101',
    status: 'connected',
  })
  assert.deepEqual(registry.capabilities.at(-1), {
    id: 'capability-101',
    name: 'Capability 101',
    service_id: 101,
  })
})
