import type { Tab } from '../../types.ts'
import { tabMatchesProjectFile } from '../../hooks/tab-state.ts'
import { encodePathSegments } from '../../app/project/project-file-path.ts'

export type ProjectFileUploadPolicy = {
  supported_extensions: string[]
  max_file_size_bytes: number
}

export type ProjectFileUploadPayload = {
  type: 'file'
  format: 'base64'
  content: string
}

export type ProjectFileUploadCompletion =
  | { message: string; mappingRemovalSucceeded: boolean }
  | {
      message: string
      mappingRemovalSucceeded: boolean
      refreshError: unknown
    }

const BASE64_CHUNK_SIZE = 0x8000

/** Validate a browser-selected filename against the server upload policy. */
export function validateProjectUploadFile(
  file: Pick<File, 'name' | 'size'>,
  policy: ProjectFileUploadPolicy,
): string | null {
  const { name, size } = file
  if (
    !name ||
    name.startsWith('.') ||
    name.endsWith('.') ||
    name.includes('/') ||
    name.includes('\\') ||
    name.includes('\0')
  ) {
    return 'Choose a file with a valid filename.'
  }

  const extensionIndex = name.lastIndexOf('.')
  const extension = extensionIndex > 0 ? name.slice(extensionIndex) : ''
  const supportedExtensions = policy.supported_extensions.map((item) =>
    item.toLowerCase(),
  )
  if (!supportedExtensions.includes(extension.toLowerCase())) {
    return `Supported file types: ${policy.supported_extensions.join(', ')}.`
  }

  if (size > policy.max_file_size_bytes) {
    return `File must be ${formatBytes(policy.max_file_size_bytes)} or smaller.`
  }

  return null
}

/** Build a root or nested upload target without changing path characters. */
export function buildProjectUploadTargetPath(
  currentPath: string,
  filename: string,
): string {
  return `${currentPath.replace(/\/$/, '')}/${filename}`
}

/** Encode each Jupyter contents path segment without encoding separators. */
export function encodeProjectContentsPath(path: string): string {
  return encodePathSegments(path)
}

/** Check whether the upload target is open in a matching project editor tab. */
export function hasOpenProjectFileEditor(
  openTabs: Tab[],
  projectId: string,
  targetPath: string,
): boolean {
  return openTabs.some((tab) =>
    tabMatchesProjectFile(tab, projectId, targetPath),
  )
}

/**
 * Invalidate an obsolete rename mapping before refreshing the file list,
 * without turning a persisted upload into a failure.
 */
export async function getProjectFileUploadCompletion(
  filename: string,
  invalidateRenameMapping: () => boolean,
  refreshListing: () => Promise<unknown>,
): Promise<ProjectFileUploadCompletion> {
  const mappingRemovalSucceeded = invalidateRenameMapping()

  try {
    await refreshListing()
    return { message: `${filename} uploaded.`, mappingRemovalSucceeded }
  } catch (refreshError) {
    return {
      message: `${filename} uploaded, but the file list could not be refreshed.`,
      mappingRemovalSucceeded,
      refreshError,
    }
  }
}

/** Preserve arbitrary file bytes while producing browser-compatible base64. */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''

  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_SIZE) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + BASE64_CHUNK_SIZE),
    )
  }

  return btoa(binary)
}

/** Construct the unchanged Jupyter-compatible base64 file payload. */
export function buildProjectFileUploadPayload(
  buffer: ArrayBuffer,
): ProjectFileUploadPayload {
  return {
    type: 'file',
    format: 'base64',
    content: arrayBufferToBase64(buffer),
  }
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 && bytes % (1024 * 1024) === 0) {
    return `${bytes / (1024 * 1024)} MiB`
  }

  return `${bytes} bytes`
}
