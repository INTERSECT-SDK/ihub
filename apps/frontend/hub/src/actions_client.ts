'use client'
import axios from 'axios'
import { JupyterCell, JupyterServerConfig, JupyterSession } from './types'

export async function getNewSession(
  jupyterServer: JupyterServerConfig,
  notebook_name: string,
): Promise<JupyterSession> {
  // create a new jupyter kernel for session
  console.log('Requesting new Jupyter kernel...', jupyterServer)
  return new Promise((resolve, reject) =>
    axios
      .post(
        `${jupyterServer.url}/api/sessions`,
        {
          kernel: { name: 'python3' },
          name: notebook_name,
          path: notebook_name,
          type: 'notebook', // Can be "notebook", "console", or "terminal"
        },
        { headers: { Authorization: `Token ${jupyterServer.token}` } },
      )
      .then((res) => {
        console.log('Kernel created!', res.data)
        resolve(res.data)
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
  const ws = new WebSocket(
    `${jupyterServer.url}/api/kernels/${jupyterSession.kernel.id}/channels?token=${jupyterServer.token}`,
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
): Promise<{ output?: string; error?: string }> {
  try {
    console.log('Received request to execute code...')
    if (!cellContent.source) {
      // console.error('No code received in request');
      return { error: 'No code provided' }
    }

    if (!jupyterSession) {
      console.error('No jupyter session provided in request')
      return { error: 'No jupyter session id provided' }
    }

    console.log('Received code:', cellContent.source)
    console.log(
      `Running the code on kernel ${jupyterSession.kernel.id} and session ${jupyterSession.id}`,
    )
    console.log('exec id', cellContent.id)

    // Open a WebSocket to Jupyter
    return new Promise((resolve, reject) => {
      // Send execution request
      const message = {
        header: {
          msg_id: cellContent.id,
          msg_type: 'execute_request',
          username: 'iHub User',
          session: jupyterSession.id,
          version: '5.3',
        },
        parent_header: {},
        metadata: {},
        content: {
          code: `${cellContent.source} # Timestamp: ${Date.now()}`,
          silent: false,
          store_history: true,
          user_expressions: {},
          allow_stdin: false,
          stop_on_error: true,
        },
        channel: 'shell',
      }

      jupyterWebSocket.send(JSON.stringify(message))

      // jupyterWebSocket.onclose = () => {
      //   console.log("WebSocket closed");
      // };
    })
  } catch (err: any) {
    console.error('Error executing code:', err.message)
    return { error: err.message }
  }
}
