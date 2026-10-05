import type { JupyterServerConfig, JupyterSession } from '../types/notebook'
import type { VariableItem } from '../types/types'

export function generateInsecureUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export const swrFetcher = (url: string) => fetch(url).then((res) => res.json())

export const PYTHON_RUNTIME_TYPE_CLASSIFIER = `
_IHUB_LIST_SAMPLE_SIZE = 32

def _ihub_list_item_type_label(val):
    if isinstance(val, bool):
        return "boolean"

    if isinstance(val, int):
        return "integer"

    if isinstance(val, float):
        return "number"

    if isinstance(val, str):
        return "string"

    if val is None:
        return "null"

    return None

def _ihub_runtime_type_label(val):
    if isinstance(val, list):
        if len(val) == 0:
            return "list"

        item_type_labels = {
            _ihub_list_item_type_label(item)
            for item in val[:_IHUB_LIST_SAMPLE_SIZE]
        }

        if None not in item_type_labels and len(item_type_labels) == 1:
            return f"{next(iter(item_type_labels))}[]"

        return "list"

    if isinstance(val, bool):
        return "bool"

    if isinstance(val, int):
        return "int"

    if isinstance(val, float):
        return "float"

    if isinstance(val, str):
        return "str"

    if val is None:
        return "NoneType"

    if isinstance(val, dict):
        return "dict"

    return type(val).__name__
`

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

export async function getKernelVariables(
  ws: WebSocket,
  sessionId: string,
): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    const msgId = 'msg_' + Math.random().toString(36).slice(2)

    const code = `
import json
import builtins

${PYTHON_RUNTIME_TYPE_CLASSIFIER}

TO_IGNORE = ['In', 'Out', 'exit', 'quit', 'json', 'builtins', 'name', 'vars_dict', 'val', 'name', 'TO_IGNORE', 'global_items']

vars_dict = {}
global_items = list(globals().items())
for name, val in global_items:
    if not name.startswith("_") and name not in dir(builtins) and name not in TO_IGNORE:
        try:
            vars_dict[name] = _ihub_runtime_type_label(val)
        except Exception:
            vars_dict[name] = "unknown"

print(json.dumps(vars_dict))
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

    function handleMessage(event: MessageEvent) {
      const data = JSON.parse(event.data)

      if (
        data.parent_header &&
        data.parent_header.msg_id === msgId &&
        data.msg_type === 'stream'
      ) {
        ws.removeEventListener('message', handleMessage)

        try {
          const variables = JSON.parse(data.content.text)
          resolve(variables)
        } catch (err) {
          reject(err)
        }
      }

      if (
        data.parent_header &&
        data.parent_header.msg_id === msgId &&
        data.msg_type === 'error'
      ) {
        ws.removeEventListener('message', handleMessage)
        reject(data.content)
      }
    }

    ws.addEventListener('message', handleMessage)
    ws.send(JSON.stringify(message))
  })
}

export function getVariablesFromNode(payload: any): VariableItem[] {
  // Accepts a published payload schema (publish.message.payload) and
  // returns a flat list of mappable values provided by it.
  if (!payload) return []

  // console.log('PAYLOAD', payload)
  const results: VariableItem[] = []

  function getSchemaTypeOptions(schema: any): string[] {
    if (!schema) return []

    if (Array.isArray(schema.anyOf)) {
      return schema.anyOf.flatMap((option: any) => getSchemaTypeOptions(option))
    }

    if (Array.isArray(schema.oneOf)) {
      return schema.oneOf.flatMap((option: any) => getSchemaTypeOptions(option))
    }

    if (Array.isArray(schema.type)) {
      return schema.type.flatMap((type: string) =>
        getSchemaTypeOptions({ ...schema, type }),
      )
    }

    if (schema.type === 'array') {
      const itemTypes = getSchemaTypeOptions(schema.items)
      return itemTypes.length > 0
        ? itemTypes.map((itemType) => `${itemType}[]`)
        : ['array']
    }

    if (schema.type === 'object') {
      return ['object']
    }

    return typeof schema.type === 'string' ? [schema.type] : []
  }

  function getSchemaTypeLabel(schema: any): string {
    const typeOptions = Array.from(new Set(getSchemaTypeOptions(schema)))
    return typeOptions.length > 0 ? typeOptions.join(' | ') : 'unknown'
  }

  function traverse(payload: any, path: string) {
    if (!payload) return

    // arrays: check items
    if (payload.type === 'array') {
      results.push({
        title: payload.title || path,
        type: getSchemaTypeLabel(payload),
        path: path,
        description: payload.description || undefined,
      })

      return
    }

    // Open-ended objects are mapped as a whole because their runtime keys are
    // not fully described by the schema. Avoid exposing fixed children too,
    // since parent and child mappings would overlap.
    if (payload.type === 'object' || payload.properties) {
      const additionalProperties = payload.additionalProperties
      const isOpenEndedObject =
        additionalProperties === true ||
        (additionalProperties !== null &&
          typeof additionalProperties === 'object' &&
          !Array.isArray(additionalProperties))

      if (isOpenEndedObject && path) {
        results.push({
          title: payload.title || path,
          type: 'object',
          path: path,
          description: payload.description || undefined,
        })
        return
      }

      // Fixed-property objects continue to expose their nested fields.
      const props = payload.properties || {}
      Object.keys(props).forEach((k) =>
        traverse(props[k], path ? `${path}.${k}` : k),
      )
      return
    }

    // fallback: if node itself is a primitive and path is empty, use title if available
    results.push({
      title: payload.title || path,
      type: getSchemaTypeLabel(payload),
      description: payload.description || undefined,
      path: path,
      default: payload.default,
    })
  }

  traverse(payload, '')

  // console.log('EXTRACTED VARIABLES', results)

  return results
}
