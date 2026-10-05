import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createDeduplicatedSessionRefresh,
  createSessionFromPayload,
  requestSession,
  type SessionRefreshResult,
} from './session.ts'

const validPayload = {
  sub: ' subject-1 ',
  given_name: ' Ada ',
  family_name: ' Lovelace ',
  preferred_username: ' ada ',
  email: ' ADA@EXAMPLE.COM ',
  role: 'user',
  exp: 12345,
}

test('constructs a normalized session from a valid auth payload', () => {
  assert.deepEqual(createSessionFromPayload(validPayload), {
    user: {
      id: 'subject-1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      username: 'ada',
      email: 'ada@example.com',
      profilePictureUrl: '',
    },
    expiresIn: '12345',
  })
})

test('rehydrates the session through the cookie-backed auth endpoint', async () => {
  let request:
    | { input: RequestInfo | URL; init: RequestInit | undefined }
    | undefined
  const result = await requestSession(async (input, init) => {
    request = { input, init }
    return Response.json(validPayload)
  })

  assert.equal(result.status, 'authenticated')
  assert.equal(
    result.status === 'authenticated' ? result.session.user.email : undefined,
    'ada@example.com',
  )
  assert.deepEqual(request, {
    input: '/api/v1/auth/user',
    init: { credentials: 'include' },
  })
})

test('treats unauthorized and forbidden responses as unauthenticated', async () => {
  for (const status of [401, 403]) {
    const result = await requestSession(
      async () => new Response(null, { status }),
    )
    assert.deepEqual(result, { status: 'unauthenticated' })
  }
})

test('reports malformed, server, and network responses as retryable errors', async () => {
  const malformed = await requestSession(async () =>
    Response.json({ ...validPayload, email: '' }),
  )
  const serverError = await requestSession(
    async () => new Response(null, { status: 503 }),
  )
  const networkError = await requestSession(async () => {
    throw new Error('network unavailable')
  })

  assert.equal(malformed.status, 'error')
  assert.equal(serverError.status, 'error')
  assert.equal(networkError.status, 'error')
  assert.match(
    serverError.status === 'error' ? serverError.error.message : '',
    /503/,
  )
})

test('deduplicates concurrent session refresh requests', async () => {
  let resolveRefresh: ((result: SessionRefreshResult) => void) | undefined
  let calls = 0
  const controller = createDeduplicatedSessionRefresh(() => {
    calls += 1
    return new Promise<SessionRefreshResult>((resolve) => {
      resolveRefresh = resolve
    })
  })

  const first = controller.refresh()
  const second = controller.refresh()

  assert.equal(first, second)
  assert.equal(calls, 1)

  resolveRefresh?.({ status: 'unauthenticated' })
  await first
  const third = controller.refresh()
  assert.equal(calls, 2)
  resolveRefresh?.({ status: 'unauthenticated' })
  await third
})

test('invalidation starts and preserves a distinct deduplicated refresh', async () => {
  const resolvers: Array<(result: SessionRefreshResult) => void> = []
  let calls = 0
  const controller = createDeduplicatedSessionRefresh(() => {
    calls += 1
    return new Promise<SessionRefreshResult>((resolve) => {
      resolvers.push(resolve)
    })
  })

  const preInvalidation = controller.refresh()
  controller.invalidate()
  const postInvalidation = controller.refresh()
  const concurrentPostInvalidation = controller.refresh()

  assert.notEqual(preInvalidation, postInvalidation)
  assert.equal(postInvalidation, concurrentPostInvalidation)
  assert.equal(calls, 2)

  resolvers[0]?.({ status: 'unauthenticated' })
  await preInvalidation

  const afterOldRequestSettles = controller.refresh()
  assert.equal(afterOldRequestSettles, postInvalidation)
  assert.equal(calls, 2)

  resolvers[1]?.({ status: 'unauthenticated' })
  await postInvalidation

  const afterNewRequestSettles = controller.refresh()
  assert.equal(calls, 3)
  resolvers[2]?.({ status: 'unauthenticated' })
  await afterNewRequestSettles
})
