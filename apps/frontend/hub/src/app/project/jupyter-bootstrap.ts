/**
 * Utilities for resolving the current user's Jupyter identity and bootstrapping
 * a ready-to-use Jupyter server configuration for notebook access.
 */
import type { JupyterServerConfig } from '@ihub/utils/types/notebook'

import type { Session } from '../providers/session.ts'

type BootstrapFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

interface JupyterServerState {
  ready: boolean
  pending: string | null
}

const SERVER_POLL_INTERVAL_MS = 500
const SERVER_POLL_TIMEOUT_MS = 60_000

function readJson(response: Response): Promise<unknown> {
  return response.json() as Promise<unknown>
}

function throwIfAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readServerState(value: unknown): JupyterServerState {
  if (
    !isRecord(value) ||
    typeof value.ready !== 'boolean' ||
    (value.pending !== null && typeof value.pending !== 'string')
  ) {
    throw new Error(
      'Invalid server readiness payload returned from JupyterHub API',
    )
  }

  return {
    ready: value.ready,
    pending: value.pending,
  }
}

function waitForPollInterval(signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal)

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', handleAbort)
      resolve()
    }, SERVER_POLL_INTERVAL_MS)

    const handleAbort = () => {
      clearTimeout(timeout)
      reject(signal?.reason)
    }

    signal?.addEventListener('abort', handleAbort, { once: true })
  })
}

async function listServers({
  endpoint,
  signal,
  fetchBootstrap,
}: {
  endpoint: string
  signal?: AbortSignal
  fetchBootstrap: BootstrapFetch
}): Promise<Record<string, unknown>> {
  const response = await fetchBootstrap(endpoint, {
    method: 'GET',
    credentials: 'include',
    signal,
  })
  throwIfAborted(signal)

  if (!response.ok) {
    throw new Error(`Failed to list Jupyter servers: ${response.status}`)
  }

  const servers = await readJson(response)
  throwIfAborted(signal)
  if (!isRecord(servers)) {
    throw new Error('Invalid server payload returned from JupyterHub API')
  }

  return servers
}

async function waitForPendingServer({
  endpoint,
  initialState,
  signal,
  fetchBootstrap,
}: {
  endpoint: string
  initialState: JupyterServerState
  signal?: AbortSignal
  fetchBootstrap: BootstrapFetch
}): Promise<void> {
  let state = initialState
  const deadline = Date.now() + SERVER_POLL_TIMEOUT_MS

  while (!state.ready) {
    if (state.pending === null) {
      throw new Error('Jupyter server failed to start')
    }

    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for Jupyter server')
    }

    await waitForPollInterval(signal)
    throwIfAborted(signal)

    const servers = await listServers({
      endpoint,
      signal,
      fetchBootstrap,
    })
    if (!Object.hasOwn(servers, '')) {
      throw new Error('Jupyter server disappeared while starting')
    }
    state = readServerState(servers[''])
  }
}

/**
 * Map an authenticated iHub session to its fixed JupyterHub identity.
 */
export function getJupyterIdentity(session: Session): string {
  const email = session.user.email.trim().toLowerCase()
  if (!email) {
    throw new Error('The authenticated session does not include an email')
  }
  return email
}

/**
 * Ensure the current user's default server exists, then mint an in-memory
 * access token and return its notebook client configuration.
 */
export async function bootstrapJupyterServer({
  session,
  signal,
  fetchBootstrap = fetch,
}: {
  session: Session
  signal?: AbortSignal
  fetchBootstrap?: BootstrapFetch
}): Promise<JupyterServerConfig> {
  const jupyterUser = getJupyterIdentity(session)
  const encodedUser = encodeURIComponent(jupyterUser)
  const serverEndpoint = `/api/v1/jupyterhub/${encodedUser}/server`

  throwIfAborted(signal)
  const servers = await listServers({
    endpoint: serverEndpoint,
    signal,
    fetchBootstrap,
  })

  if (!Object.hasOwn(servers, '')) {
    const startResponse = await fetchBootstrap(serverEndpoint, {
      method: 'POST',
      credentials: 'include',
      signal,
    })
    throwIfAborted(signal)

    if (!startResponse.ok) {
      throw new Error(`Failed to start Jupyter server: ${startResponse.status}`)
    }

    const startedServerPayload = await readJson(startResponse)
    throwIfAborted(signal)
    const startedServer = readServerState(startedServerPayload)
    if (!startedServer.ready) {
      throw new Error('Jupyter server did not become ready after starting')
    }
  } else {
    await waitForPendingServer({
      endpoint: serverEndpoint,
      initialState: readServerState(servers['']),
      signal,
      fetchBootstrap,
    })
  }

  const tokenResponse = await fetchBootstrap(
    `/api/v1/jupyterhub/${encodedUser}/token`,
    {
      method: 'POST',
      credentials: 'include',
      signal,
    },
  )
  throwIfAborted(signal)

  if (!tokenResponse.ok) {
    throw new Error(`Failed to fetch Jupyter token: ${tokenResponse.status}`)
  }

  const tokenPayload = await readJson(tokenResponse)
  throwIfAborted(signal)
  if (
    !isRecord(tokenPayload) ||
    typeof tokenPayload.token !== 'string' ||
    !tokenPayload.token.trim()
  ) {
    throw new Error('Invalid token payload returned from JupyterHub API')
  }

  return {
    id: `${jupyterUser}-jupyter`,
    url: `/ijupyterhub/user/${jupyterUser}`,
    token: tokenPayload.token,
    label: `${session.user.firstName}'s Jupyter Server`,
  }
}
