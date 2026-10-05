/* eslint-disable @typescript-eslint/no-require-imports -- Node's direct TS test runner needs require() for the sibling .ts helper without changing package module settings. */
const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')

const { createConnectionToJupyterSession } =
  require('./actions.ts') as typeof import('./actions')

type JupyterServerConfig =
  import('@ihub/utils/types/notebook').JupyterServerConfig
type JupyterSession = import('@ihub/utils/types/notebook').JupyterSession

class MockWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3

  readonly url: string
  onopen: (() => void) | null = null

  constructor(url: string) {
    this.url = url
  }
}

const jupyterSession: JupyterSession = {
  id: 'session-1',
  kernel: {
    connections: 0,
    execution_state: 'idle',
    id: 'kernel-1',
    last_activity: '2026-07-13T00:00:00.000Z',
    name: 'python3',
  },
  name: 'notebook.ipynb',
  notebook: {
    path: 'notebook.ipynb',
    name: 'notebook.ipynb',
  },
  path: 'notebook.ipynb',
  type: 'notebook',
}

function mockBrowser(origin: string): () => void {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const originalWebSocket = Object.getOwnPropertyDescriptor(
    globalThis,
    'WebSocket',
  )

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { location: new URL(origin) },
  })
  Object.defineProperty(globalThis, 'WebSocket', {
    configurable: true,
    value: MockWebSocket,
  })

  return () => {
    if (originalWindow) {
      Object.defineProperty(globalThis, 'window', originalWindow)
    } else {
      Reflect.deleteProperty(globalThis, 'window')
    }

    if (originalWebSocket) {
      Object.defineProperty(globalThis, 'WebSocket', originalWebSocket)
    } else {
      Reflect.deleteProperty(globalThis, 'WebSocket')
    }
  }
}

function createJupyterServer(url: string): JupyterServerConfig {
  return {
    id: 'jupyter-1',
    url,
    token: 'token-1',
    label: 'Jupyter',
  }
}

test('relative Jupyter URLs use WS on the local HTTP origin', async (t) => {
  t.after(mockBrowser('http://localhost:8080'))

  const socket = await createConnectionToJupyterSession(
    jupyterSession,
    createJupyterServer('/ijupyterhub/user/testuser/'),
  )

  assert.ok(socket instanceof MockWebSocket)
  assert.equal(
    socket.url,
    'ws://localhost:8080/ijupyterhub/user/testuser/api/kernels/kernel-1/channels?token=token-1',
  )
})

test('relative Jupyter URLs use WSS on the same HTTPS origin', async (t) => {
  t.after(mockBrowser('https://ihub.example.org'))

  const socket = await createConnectionToJupyterSession(
    jupyterSession,
    createJupyterServer('/ijupyterhub/user/testuser/'),
  )

  assert.ok(socket instanceof MockWebSocket)
  assert.equal(
    socket.url,
    'wss://ihub.example.org/ijupyterhub/user/testuser/api/kernels/kernel-1/channels?token=token-1',
  )
})
