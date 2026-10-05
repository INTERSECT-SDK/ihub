import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import type { Session } from '../providers/session.ts'
import {
  bootstrapJupyterServer,
  getJupyterIdentity,
} from './jupyter-bootstrap.ts'

function makeSession(overrides: Partial<Session['user']> = {}): Session {
  return {
    user: {
      id: 'subject-1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      username: 'ada',
      email: ' ADA@EXAMPLE.COM ',
      profilePictureUrl: '',
      ...overrides,
    },
    expiresIn: '',
  }
}

test('selects the normalized authenticated user identity', () => {
  assert.equal(getJupyterIdentity(makeSession()), 'ada@example.com')
})

test('uses an existing default server and returns validated token config', async () => {
  const requests: Array<{ url: string; method: string | undefined }> = []
  const server = await bootstrapJupyterServer({
    session: makeSession(),
    fetchBootstrap: async (input, init) => {
      requests.push({ url: String(input), method: init?.method })
      if (String(input).endsWith('/server')) {
        return Response.json({ '': { ready: true, pending: null } })
      }
      return Response.json({ token: 'token-1' })
    },
  })

  assert.deepEqual(requests, [
    {
      url: '/api/v1/jupyterhub/ada%40example.com/server',
      method: 'GET',
    },
    {
      url: '/api/v1/jupyterhub/ada%40example.com/token',
      method: 'POST',
    },
  ])
  assert.deepEqual(server, {
    id: 'ada@example.com-jupyter',
    url: '/ijupyterhub/user/ada@example.com',
    token: 'token-1',
    label: "Ada's Jupyter Server",
  })
})

test('starts a missing default server before minting a user token', async () => {
  const requests: string[] = []
  const server = await bootstrapJupyterServer({
    session: makeSession(),
    fetchBootstrap: async (input, init) => {
      requests.push(`${init?.method} ${String(input)}`)
      if (init?.method === 'GET') {
        return Response.json({})
      }
      if (String(input).endsWith('/server')) {
        return Response.json({ ready: true, pending: null })
      }
      return Response.json({ token: 'user-token' })
    },
  })

  assert.deepEqual(requests, [
    'GET /api/v1/jupyterhub/ada%40example.com/server',
    'POST /api/v1/jupyterhub/ada%40example.com/server',
    'POST /api/v1/jupyterhub/ada%40example.com/token',
  ])
  assert.equal(server.label, "Ada's Jupyter Server")
  assert.equal(server.token, 'user-token')
})

test('waits for an existing pending server before minting a token', async () => {
  const requests: string[] = []
  let listCalls = 0
  const server = await bootstrapJupyterServer({
    session: makeSession(),
    fetchBootstrap: async (input, init) => {
      requests.push(`${init?.method} ${String(input)}`)
      if (String(input).endsWith('/server')) {
        listCalls += 1
        return Response.json({
          '': {
            ready: listCalls === 3,
            pending: listCalls === 3 ? null : 'spawn',
          },
        })
      }
      return Response.json({ token: 'token-after-ready' })
    },
  })

  assert.deepEqual(requests, [
    'GET /api/v1/jupyterhub/ada%40example.com/server',
    'GET /api/v1/jupyterhub/ada%40example.com/server',
    'GET /api/v1/jupyterhub/ada%40example.com/server',
    'POST /api/v1/jupyterhub/ada%40example.com/token',
  ])
  assert.equal(server.token, 'token-after-ready')
})

test('rejects malformed server readiness states', async () => {
  await assert.rejects(
    bootstrapJupyterServer({
      session: makeSession(),
      fetchBootstrap: async () => Response.json([]),
    }),
    /Invalid server payload/,
  )

  for (const serverState of [
    { ready: 'yes', pending: null },
    { ready: false },
    { ready: false, pending: false },
  ]) {
    await assert.rejects(
      bootstrapJupyterServer({
        session: makeSession(),
        fetchBootstrap: async () =>
          Response.json({
            '': serverState,
          }),
      }),
      /Invalid server readiness payload/,
    )
  }
})

test('rejects a non-ready response after starting a missing server', async () => {
  await assert.rejects(
    bootstrapJupyterServer({
      session: makeSession(),
      fetchBootstrap: async (_input, init) =>
        init?.method === 'GET'
          ? Response.json({})
          : Response.json({ ready: false, pending: 'spawn' }),
    }),
    /did not become ready/,
  )
})

test('reports terminal startup failure without minting a token', async () => {
  let calls = 0
  await assert.rejects(
    bootstrapJupyterServer({
      session: makeSession(),
      fetchBootstrap: async () => {
        calls += 1
        return Response.json({
          '': { ready: false, pending: null },
        })
      },
    }),
    /failed to start/,
  )
  assert.equal(calls, 1)
})

test('times out while waiting for a pending server', async () => {
  const originalDateNow = Date.now
  let nowCalls = 0
  Date.now = () => {
    nowCalls += 1
    return nowCalls === 1 ? 0 : 60_000
  }

  try {
    await assert.rejects(
      bootstrapJupyterServer({
        session: makeSession(),
        fetchBootstrap: async () =>
          Response.json({
            '': { ready: false, pending: 'spawn' },
          }),
      }),
      /Timed out waiting for Jupyter server/,
    )
  } finally {
    Date.now = originalDateNow
  }
})

test('rejects invalid token payloads and retryable HTTP failures', async () => {
  await assert.rejects(
    bootstrapJupyterServer({
      session: makeSession(),
      fetchBootstrap: async (input) =>
        String(input).endsWith('/server')
          ? Response.json({ '': { ready: true, pending: null } })
          : Response.json({ token: '' }),
    }),
    /Invalid token payload/,
  )

  await assert.rejects(
    bootstrapJupyterServer({
      session: makeSession(),
      fetchBootstrap: async () => new Response(null, { status: 503 }),
    }),
    /503/,
  )
})

test('supports aborting while polling a pending server', async () => {
  const abortController = new AbortController()
  let calls = 0
  const bootstrap = bootstrapJupyterServer({
    session: makeSession(),
    signal: abortController.signal,
    fetchBootstrap: async () => {
      calls += 1
      return Response.json({
        '': { ready: false, pending: 'spawn' },
      })
    },
  })

  await Promise.resolve()
  await Promise.resolve()
  abortController.abort()

  await assert.rejects(bootstrap, { name: 'AbortError' })
  assert.equal(calls, 1)
})

test('the shared project layout gates direct child routes with the bootstrap', () => {
  const layoutSource = readFileSync(
    new URL('./layout.tsx', import.meta.url),
    'utf8',
  )

  assert.match(layoutSource, /ProjectBootstrapBoundary/)
  assert.match(
    layoutSource,
    /<ProjectBootstrapBoundary>\{children\}<\/ProjectBootstrapBoundary>/,
  )
})
