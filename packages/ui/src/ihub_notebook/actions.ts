'use client'
import type {
  JupyterCell,
  JupyterServerConfig,
  JupyterSession,
  NewSessionRequestBody,
} from '@ihub/utils/types/notebook'

async function waitForWebSocketOpen(
  socket: WebSocket,
  timeoutMs = 5000,
): Promise<void> {
  if (socket.readyState === WebSocket.OPEN) {
    return
  }

  if (
    socket.readyState === WebSocket.CLOSING ||
    socket.readyState === WebSocket.CLOSED
  ) {
    throw new Error('Kernel connection is not open')
  }

  await new Promise<void>((resolve, reject) => {
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null

    const cleanup = () => {
      socket.removeEventListener('open', handleOpen)
      socket.removeEventListener('error', handleError)
      if (timeoutHandle) {
        clearTimeout(timeoutHandle)
      }
    }

    const handleOpen = () => {
      cleanup()
      resolve()
    }

    const handleError = () => {
      cleanup()
      reject(new Error('Kernel connection failed before execute request'))
    }

    socket.addEventListener('open', handleOpen, { once: true })
    socket.addEventListener('error', handleError, { once: true })

    timeoutHandle = setTimeout(() => {
      cleanup()
      reject(new Error('Timed out waiting for kernel connection'))
    }, timeoutMs)
  })
}

function normalizeHttpBaseUrl(rawUrl: string): string {
  const trimmedUrl = rawUrl.trim()

  if (trimmedUrl.startsWith('/')) {
    return trimmedUrl.replace(/\/$/, '')
  }

  const withProtocol = /^https?:\/\//i.test(trimmedUrl)
    ? trimmedUrl
    : `http://${trimmedUrl}`
  const parsed = new URL(withProtocol)
  return parsed.toString().replace(/\/$/, '')
}

function toWebSocketBaseUrl(rawUrl: string): string {
  const normalizedUrl = normalizeHttpBaseUrl(rawUrl)

  if (normalizedUrl.startsWith('/')) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${protocol}//${window.location.host}${normalizedUrl}`.replace(
      /\/$/,
      '',
    )
  }

  const parsed = new URL(normalizedUrl)
  parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:'
  return parsed.toString().replace(/\/$/, '')
}

export async function getNewSession(
  jupyterServer: JupyterServerConfig,
  notebook_name: string,
): Promise<JupyterSession> {
  // create a new jupyter kernel for session
  console.log('Requesting new Jupyter kernel...', jupyterServer)
  const baseUrl = normalizeHttpBaseUrl(jupyterServer.url)
  const url: string = `${baseUrl}/api/sessions`
  const data: NewSessionRequestBody = {
    kernel: { name: 'python3' },
    name: notebook_name,
    path: notebook_name,
    type: 'notebook', // Can be "notebook", "console", or "terminal"
  }

  return new Promise((resolve, reject) =>
    fetch(url, {
      method: 'POST', // Specifying the request method
      headers: { Authorization: `Bearer ${jupyterServer.token}` },
      body: JSON.stringify(data), // Converting the data to JSON
    })
      .then((res) => {
        return res.json()
      })
      .then((data) => {
        console.log('Kernel created!', data)
        resolve(data)
      })
      .catch((err) => {
        console.error('Error creating the session', err)
        reject({ error: 'Error creating the session' })
      }),
  )
}

export async function createConnectionToJupyterSession(
  jupyterSession: JupyterSession,
  jupyterServer: JupyterServerConfig,
): Promise<WebSocket> {
  const wsBaseUrl = toWebSocketBaseUrl(jupyterServer.url)
  const ws = new WebSocket(
    `${wsBaseUrl}/api/kernels/${jupyterSession.kernel.id}/channels?token=${jupyterServer.token}`,
  )

  ws.onopen = () => {
    console.log(
      'WebSocket connected to Jupyter Kernel:',
      jupyterSession.kernel.id,
    )
  }

  return ws
}

export async function runCode(
  cellContent: JupyterCell,
  jupyterSession: JupyterSession,
  jupyterWebSocket: WebSocket,
  exec_id?: string,
): Promise<{ output?: string; error?: string }> {
  try {
    console.log('Received request to execute code...')

    if (!jupyterSession) {
      console.error('No jupyter session provided in request')
      return { error: 'No jupyter session id provided' }
    }

    await waitForWebSocketOpen(jupyterWebSocket)

    console.log('Received code:', cellContent.source)
    console.log(
      `Running the code on kernel ${jupyterSession.kernel.id} and session ${jupyterSession.id}`,
    )
    console.log('exec id', cellContent.id)

    const message = {
      header: {
        msg_id: exec_id ? exec_id : `${cellContent.id}`,
        msg_type: 'execute_request',
        username: 'iHub User',
        session: jupyterSession.id,
        version: '5.3',
      },
      parent_header: {},
      metadata: {},
      content: {
        code: `${cellContent.source || ''}`,
        silent: false,
        store_history: true,
        user_expressions: {},
        allow_stdin: false,
        stop_on_error: true,
      },
      channel: 'shell',
    }

    jupyterWebSocket.send(JSON.stringify(message))
    return { output: 'Execution request sent' }
  } catch (err: any) {
    console.error('Error executing code:', err.message)
    return { error: err.message }
  }
}
