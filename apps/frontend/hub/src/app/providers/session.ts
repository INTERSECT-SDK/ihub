/**
 * Defines session domain types and utilities for restoring, validating, and
 * deduplicating the authenticated user session in the hub frontend.
 */
export interface SessionUser {
  id: string
  firstName: string
  lastName: string
  username: string
  email: string
  profilePictureUrl: string
}

export interface Session {
  user: SessionUser
  expiresIn: string
}

export type SessionStatus =
  | 'loading'
  | 'authenticated'
  | 'unauthenticated'
  | 'error'

export type SessionRefreshResult =
  | { status: 'authenticated'; session: Session }
  | { status: 'unauthenticated' }
  | { status: 'error'; error: Error }

type FetchSession = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

/** Controls deduplicated session refreshes and invalidates cached work. */
export interface SessionRefreshController {
  refresh: () => Promise<SessionRefreshResult>
  invalidate: () => void
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim()
  return normalized || undefined
}

/**
 * Validate an auth-user response and construct the frontend session model.
 */
export function createSessionFromPayload(payload: unknown): Session {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Invalid user session payload')
  }

  const userData = payload as Record<string, unknown>
  const id = nonEmptyString(userData.sub)
  const firstName = nonEmptyString(userData.given_name)
  const lastName = nonEmptyString(userData.family_name)
  const username = nonEmptyString(userData.preferred_username)
  const email = nonEmptyString(userData.email)?.toLowerCase()

  if (!id || !firstName || !lastName || !username || !email) {
    throw new Error('Invalid user session payload')
  }

  const expiresIn =
    typeof userData.exp === 'number' || typeof userData.exp === 'string'
      ? String(userData.exp)
      : ''

  return {
    user: {
      id,
      firstName,
      lastName,
      username,
      email,
      profilePictureUrl: '',
    },
    expiresIn,
  }
}

/**
 * Resolve the current HttpOnly-cookie-backed session without exposing the
 * underlying credential to browser JavaScript.
 */
export async function requestSession(
  fetchSession: FetchSession = fetch,
): Promise<SessionRefreshResult> {
  try {
    const response = await fetchSession('/api/v1/auth/user', {
      credentials: 'include',
    })

    if (response.status === 401 || response.status === 403) {
      return { status: 'unauthenticated' }
    }

    if (!response.ok) {
      return {
        status: 'error',
        error: new Error(`Failed to restore session: ${response.status}`),
      }
    }

    const payload: unknown = await response.json()
    return {
      status: 'authenticated',
      session: createSessionFromPayload(payload),
    }
  } catch (error) {
    return {
      status: 'error',
      error:
        error instanceof Error
          ? error
          : new Error('Failed to restore the user session'),
    }
  }
}

/**
 * Share an in-flight refresh among concurrent callers.
 */
export function createDeduplicatedSessionRefresh(
  refresh: () => Promise<SessionRefreshResult>,
): SessionRefreshController {
  let inFlight: Promise<SessionRefreshResult> | undefined

  return {
    refresh: () => {
      if (inFlight) {
        return inFlight
      }

      const request = refresh()
      inFlight = request
      void request.then(
        () => {
          if (inFlight === request) {
            inFlight = undefined
          }
        },
        () => {
          if (inFlight === request) {
            inFlight = undefined
          }
        },
      )
      return request
    },
    invalidate: () => {
      inFlight = undefined
    },
  }
}
