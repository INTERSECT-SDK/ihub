import type {
  CampaignNode,
  JsonFileField,
  JsonFileFieldType,
  JsonFileNode,
  JsonFileReference,
} from '@ihub/utils/types/campaign'
import type { JupyterServerConfig } from '@ihub/utils/types/notebook'
import type { ContentFile } from '@ihub/utils/types/types'

export type LoadedJsonProjectFile = {
  value: unknown
  contentHash: string
}

export type JsonFileNodeValue = {
  value: unknown
  runtimeType: string
}

export type JsonFileNodeValueResolver = (
  sourceNode: CampaignNode,
  sourceParameter: string,
) => Promise<JsonFileNodeValue>

const ARRAY_ITEM_TYPES = new Set<JsonFileFieldType>([
  'string',
  'boolean',
  'integer',
  'number',
  'null',
  'object',
])

/**
 * Escapes a single JSON Pointer token according to RFC 6901.
 *
 * @param token - Raw object key or array index segment.
 * @returns The escaped token safe for pointer serialization.
 */
export function escapeJsonPointerToken(token: string): string {
  return token.replaceAll('~', '~0').replaceAll('/', '~1')
}

function unescapeJsonPointerToken(token: string): string {
  if (/(?:~[^01]|~$)/.test(token)) {
    throw new Error('the JSON Pointer is invalid')
  }
  return token.replaceAll('~1', '/').replaceAll('~0', '~')
}

/**
 * Infers the supported campaign field type for a JSON value.
 *
 * @param value - Parsed JSON value to classify.
 * @returns The mapped field type, or `null` when unsupported.
 */
export function inferJsonValueType(value: unknown): JsonFileFieldType | null {
  if (value === null) return 'null'
  if (typeof value === 'string') return 'string'
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    if (Number.isInteger(value)) {
      return Number.isSafeInteger(value) ? 'integer' : null
    }
    return 'number'
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return null

    const itemTypes = value.map((item) => inferJsonValueType(item))
    if (
      itemTypes.some(
        (itemType) => itemType === null || !ARRAY_ITEM_TYPES.has(itemType),
      )
    ) {
      return null
    }

    const distinctTypes = new Set(itemTypes)
    if (
      distinctTypes.size === 2 &&
      distinctTypes.has('integer') &&
      distinctTypes.has('number')
    ) {
      return 'number[]'
    }
    if (distinctTypes.size !== 1) return null

    return `${itemTypes[0]}[]` as JsonFileFieldType
  }
  if (typeof value === 'object') return 'object'
  return null
}

function getFieldDisplayName(path: string[]): string {
  return path.length === 0 ? '$' : path.join(' › ')
}

/**
 * Builds a manifest of JSON Pointer-addressable fields from a parsed document.
 *
 * @param value - Root JSON value selected in the file picker.
 * @returns Flattened field metadata used for node mapping.
 */
export function buildJsonFileManifest(value: unknown): JsonFileField[] {
  const fields: JsonFileField[] = []

  const visit = (currentValue: unknown, path: string[]) => {
    const pointer =
      path.length === 0 ? '' : `/${path.map(escapeJsonPointerToken).join('/')}`
    const type = inferJsonValueType(currentValue)
    fields.push({
      pointer,
      displayName: getFieldDisplayName(path),
      type,
      ...(type === null
        ? {
            unsupportedReason: Array.isArray(currentValue)
              ? 'Empty, heterogeneous, or nested arrays cannot be mapped.'
              : 'This value type cannot be mapped.',
          }
        : {}),
    })

    if (
      currentValue !== null &&
      typeof currentValue === 'object' &&
      !Array.isArray(currentValue)
    ) {
      for (const [key, childValue] of Object.entries(currentValue)) {
        visit(childValue, [...path, key])
      }
    }
  }

  visit(value, [])
  return fields
}

/**
 * Resolves an RFC 6901 JSON Pointer against a parsed JSON value.
 *
 * @param value - Root JSON value to traverse.
 * @param pointer - JSON Pointer path (`''` for the root value).
 * @returns The value located at the given pointer.
 * @throws Error When the pointer syntax is invalid or path does not exist.
 */
export function resolveJsonPointer(value: unknown, pointer: string): unknown {
  if (pointer === '') return value
  if (!pointer.startsWith('/')) {
    throw new Error('the JSON Pointer is invalid')
  }

  let current = value
  for (const encodedToken of pointer.slice(1).split('/')) {
    const token = unescapeJsonPointerToken(encodedToken)
    if (Array.isArray(current)) {
      if (!/^(0|[1-9]\d*)$/.test(token)) {
        throw new Error('the JSON Pointer does not exist')
      }
      const index = Number(token)
      if (index >= current.length) {
        throw new Error('the JSON Pointer does not exist')
      }
      current = current[index]
      continue
    }
    if (
      current === null ||
      typeof current !== 'object' ||
      !Object.prototype.hasOwnProperty.call(current, token)
    ) {
      throw new Error('the JSON Pointer does not exist')
    }
    current = (current as Record<string, unknown>)[token]
  }
  return current
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

/**
 * Validates that a path is a relative project file path with no traversal.
 *
 * @param path - Project-relative path provided by the file picker.
 * @throws Error When the path is empty, absolute, or contains invalid segments.
 */
export function validateProjectRelativePath(path: string): void {
  const segments = path.split('/')
  if (
    !path ||
    path.startsWith('/') ||
    segments.some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error('the project-relative file path is invalid')
  }
}

/**
 * Builds the Jupyter Contents API URL for a project JSON file reference.
 *
 * @param serverUrl - Base URL of the selected Jupyter server.
 * @param reference - Project/file identifiers for the target JSON document.
 * @returns Fully encoded contents endpoint URL.
 * @throws Error When the project ID or file path is invalid.
 */
export function buildJsonFileContentsUrl(
  serverUrl: string,
  reference: Pick<JsonFileReference, 'projectId' | 'path'>,
): string {
  if (
    !reference.projectId ||
    reference.projectId.includes('/') ||
    reference.projectId === '.' ||
    reference.projectId === '..'
  ) {
    throw new Error('the project ID is invalid')
  }
  validateProjectRelativePath(reference.path)
  const fullPath = `projects/${reference.projectId}/${reference.path}`
  return `${serverUrl}/api/contents/${encodePath(fullPath)}`
}

/**
 * Finds the configured Jupyter server for a JSON file reference.
 *
 * @param reference - File reference containing the selected server ID.
 * @param servers - Available server configurations.
 * @returns The matched server config, if present.
 */
export function findJsonFileServer(
  reference: JsonFileReference,
  servers: JupyterServerConfig[],
): JupyterServerConfig | undefined {
  return servers.find(
    (server) => String(server.id) === String(reference.jupyterServerId),
  )
}

function validateJsonIntegerRange(value: unknown): void {
  if (typeof value === 'number') {
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      throw new Error(
        "the selected file contains an integer outside JavaScript's safe integer range",
      )
    }
    return
  }

  if (Array.isArray(value)) {
    value.forEach(validateJsonIntegerRange)
    return
  }

  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(validateJsonIntegerRange)
  }
}

/**
 * Loads, parses, and hashes the current referenced JSON project file.
 *
 * @param reference - Selected JSON file reference.
 * @param servers - Available Jupyter server configurations.
 * @param fetchImpl - Fetch implementation used for network requests.
 * @returns Parsed JSON value with a deterministic content hash.
 * @throws Error When the server, response, or JSON payload is invalid.
 */
export async function loadJsonProjectFile(
  reference: JsonFileReference,
  servers: JupyterServerConfig[],
  fetchImpl: typeof fetch = fetch,
): Promise<LoadedJsonProjectFile> {
  const server = findJsonFileServer(reference, servers)
  if (!server) {
    throw new Error('the configured Jupyter server is unavailable')
  }

  const response = await fetchImpl(
    buildJsonFileContentsUrl(server.url, reference),
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${server.token}`,
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
    },
  )
  if (!response.ok) {
    throw new Error('the JSON file is unavailable')
  }

  let responseBody: unknown
  try {
    responseBody = await response.json()
  } catch {
    throw new Error('the file response is invalid')
  }
  const content = (responseBody as { content?: unknown })?.content
  if (content === undefined) {
    throw new Error('the file response did not include content')
  }

  const rawContent =
    typeof content === 'string' ? content : JSON.stringify(content)
  let value: unknown
  try {
    value = typeof content === 'string' ? JSON.parse(content) : content
  } catch {
    throw new Error('the selected file does not contain valid JSON')
  }
  validateJsonIntegerRange(value)

  const encodedContent = new TextEncoder().encode(rawContent)
  const digest = await crypto.subtle.digest('SHA-256', encodedContent)
  const contentHash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')

  return { value, contentHash }
}

/**
 * Filters picker entries to directories and `.json` files only.
 *
 * @param entries - Raw entries returned from the contents API.
 * @returns Entries allowed by the JSON file picker.
 */
export function filterJsonPickerEntries(entries: ContentFile[]): ContentFile[] {
  return entries.filter(
    (entry) =>
      entry.type === 'directory' ||
      (entry.type === 'file' && entry.name.toLowerCase().endsWith('.json')),
  )
}

/**
 * Creates a resolver that reads mapped values from JSON-file campaign nodes.
 *
 * Each resolver instance memoizes file fetches by server/project/path so
 * repeated field lookups during one run reuse the same loaded document.
 *
 * @param jupyterServers - Available Jupyter server configurations.
 * @param fetchImpl - Fetch implementation used for file loading.
 * @returns Async resolver for mapped node parameter values.
 */
export function createJsonFileNodeValueResolver(
  jupyterServers: JupyterServerConfig[],
  fetchImpl: typeof fetch = fetch,
): JsonFileNodeValueResolver {
  const fileRequests = new Map<string, ReturnType<typeof loadJsonProjectFile>>()

  return async (sourceNode, sourceParameter) => {
    const nodeData = sourceNode.data as JsonFileNode
    const reference = nodeData.fileReference
    if (!reference) {
      throw new Error('no JSON file is selected')
    }

    const manifestField = nodeData.manifest?.find(
      (field) => field.pointer === sourceParameter,
    )
    if (!manifestField || manifestField.type === null) {
      throw new Error('the mapped JSON field is not available in the manifest')
    }

    const cacheKey = JSON.stringify([
      reference.jupyterServerId,
      reference.projectId,
      reference.path,
    ])
    let fileRequest = fileRequests.get(cacheKey)
    if (!fileRequest) {
      fileRequest = loadJsonProjectFile(reference, jupyterServers, fetchImpl)
      fileRequests.set(cacheKey, fileRequest)
    }

    const loadedFile = await fileRequest
    if (
      !nodeData.contentHash ||
      loadedFile.contentHash !== nodeData.contentHash
    ) {
      throw new Error(
        'the JSON file has not been reviewed or has changed; refresh fields before running the campaign',
      )
    }
    const value = resolveJsonPointer(loadedFile.value, sourceParameter)
    const runtimeType = inferJsonValueType(value)
    if (!runtimeType) {
      throw new Error('the mapped JSON value has an unresolved runtime type')
    }
    return { value, runtimeType }
  }
}
