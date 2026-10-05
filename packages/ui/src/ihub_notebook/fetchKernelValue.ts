/**
 * Reads a JSON-serializable Python variable from a live Jupyter kernel.
 *
 * Sends a one-off `execute_request` over the kernel websocket, validates that
 * responses belong to that request, and resolves with the parsed value printed
 * by the kernel. The variable name is encoded as JSON and resolved indirectly
 * through `globals()` so Unicode names and other global keys remain safe.
 *
 * @param ws - Open websocket connected to the target kernel channels endpoint.
 * @param sessionId - Jupyter session identifier to include in the request header.
 * @param variableName - Python global variable name to read from the kernel.
 * @returns The parsed JSON value stored in the kernel variable.
 * @throws When the kernel reports an error, the websocket closes/errors, the
 * response is malformed, or the request times out.
 */
export async function fetchKernelVariableValue(
  ws: WebSocket,
  sessionId: string,
  variableName: string,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const msgId = 'msg_' + Math.random().toString(36).slice(2)
    let settled = false
    const encodedVariableName = JSON.stringify(variableName)

    const code = `
import json
try:
    variable_name = ${encodedVariableName}
    print(json.dumps(globals()[variable_name]))
except Exception as e:
    print(json.dumps({"__error__": str(e)}))
`

    const message = {
      header: {
        msg_id: msgId,
        username: 'iHubUser',
        session: sessionId,
        msg_type: 'execute_request',
        version: '5.3',
      },
      parent_header: {},
      metadata: {},
      content: {
        code: code,
        silent: false,
        store_history: false,
        user_expressions: {},
        allow_stdin: false,
        stop_on_error: true,
      },
    }

    const timeout = globalThis.setTimeout(() => {
      settle(
        'reject',
        new Error('Timed out waiting for the kernel variable value'),
      )
    }, 15000)

    /**
     * Removes listeners and clears the timeout once the request is settled.
     */
    function cleanup() {
      globalThis.clearTimeout(timeout)
      ws.removeEventListener('message', handleMessage)
      ws.removeEventListener('close', handleClose)
      ws.removeEventListener('error', handleError)
    }

    /**
     * Completes the pending request exactly once and releases websocket hooks.
     *
     * @param outcome - Whether to resolve or reject the outer promise.
     * @param value - Parsed value or error reason used to settle the promise.
     */
    function settle(outcome: 'resolve' | 'reject', value: unknown) {
      if (settled) {
        return
      }

      settled = true
      cleanup()
      if (outcome === 'resolve') {
        resolve(value)
        return
      }

      reject(value)
    }

    /**
     * Handles kernel channel frames and settles when a matching response arrives.
     *
     * Ignores unrelated frames, validates stream payloads before parsing them as
     * JSON, and turns kernel-side errors into rejected JavaScript errors.
     *
     * @param event - Websocket message event emitted by the kernel connection.
     */
    function handleMessage(event: MessageEvent) {
      if (typeof event.data !== 'string') {
        return
      }

      let data: unknown

      try {
        data = JSON.parse(event.data) as unknown
      } catch {
        return
      }

      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return
      }

      const frame = data as {
        parent_header?: unknown
        msg_type?: unknown
        content?: unknown
      }
      const parentHeader = frame.parent_header
      if (
        !parentHeader ||
        typeof parentHeader !== 'object' ||
        Array.isArray(parentHeader) ||
        (parentHeader as { msg_id?: unknown }).msg_id !== msgId
      ) {
        return
      }

      if (frame.msg_type === 'stream') {
        const content = frame.content
        if (
          !content ||
          typeof content !== 'object' ||
          Array.isArray(content) ||
          typeof (content as { text?: unknown }).text !== 'string'
        ) {
          settle('reject', new Error('Malformed kernel stream response'))
          return
        }

        try {
          const parsed = JSON.parse(
            (content as { text: string }).text,
          ) as unknown
          if (
            parsed !== null &&
            typeof parsed === 'object' &&
            Object.prototype.hasOwnProperty.call(parsed, '__error__')
          ) {
            settle(
              'reject',
              new Error(String((parsed as { __error__: unknown }).__error__)),
            )
          } else {
            settle('resolve', parsed)
          }
        } catch (err) {
          settle('reject', err)
        }
        return
      }

      if (frame.msg_type === 'error') {
        const content = frame.content
        const errorValue =
          content && typeof content === 'object' && !Array.isArray(content)
            ? (content as { evalue?: unknown }).evalue
            : undefined
        settle(
          'reject',
          new Error(
            typeof errorValue === 'string' && errorValue
              ? errorValue
              : 'Unknown kernel error',
          ),
        )
      }
    }

    /**
     * Rejects the request if the websocket closes before a matching response.
     */
    function handleClose() {
      settle('reject', new Error('Kernel websocket closed before responding'))
    }

    /**
     * Rejects the request when the websocket reports a transport error.
     */
    function handleError() {
      settle('reject', new Error('Kernel websocket error'))
    }

    ws.addEventListener('message', handleMessage)
    ws.addEventListener('close', handleClose)
    ws.addEventListener('error', handleError)

    try {
      ws.send(JSON.stringify(message))
    } catch (error) {
      settle('reject', error)
    }
  })
}
