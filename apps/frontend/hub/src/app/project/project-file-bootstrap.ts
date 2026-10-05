/**
 * Shared bootstrap types and logic for opening or creating a project file while
 * handling stale rename mappings and superseded async requests safely.
 */
export type ProjectFileReadResult<T> =
  | { status: 'found'; document: T }
  | { status: 'missing' }

export type ProjectFileBootstrapResult<T> =
  | {
      status: 'loaded'
      document: T
      mappingRemovalSucceeded: boolean
    }
  | { status: 'retarget'; contentPath: string }
  | { status: 'missing' }
  | { status: 'superseded' }

interface BootstrapProjectFileOptions<T> {
  requestedContentPath: string
  createMode: boolean
  readRequestedFile: () => Promise<ProjectFileReadResult<T>>
  createRequestedFile: () => Promise<T>
  resolveContentPath: () => string
  invalidateRenameMapping: () => boolean
  isCurrent: () => boolean
}

/**
 * Loads a requested project path before consulting stale rename mappings.
 * Callers must hold ownership of the requested path while this runs.
 */
export async function bootstrapProjectFile<T>({
  requestedContentPath,
  createMode,
  readRequestedFile,
  createRequestedFile,
  resolveContentPath,
  invalidateRenameMapping,
  isCurrent,
}: BootstrapProjectFileOptions<T>): Promise<ProjectFileBootstrapResult<T>> {
  const confirmRequestedFile = async (
    document: T,
  ): Promise<ProjectFileBootstrapResult<T>> => {
    if (!isCurrent()) {
      return { status: 'superseded' }
    }

    return {
      status: 'loaded',
      document,
      mappingRemovalSucceeded: invalidateRenameMapping(),
    }
  }

  if (createMode) {
    return await confirmRequestedFile(await createRequestedFile())
  }

  const readResult = await readRequestedFile()
  if (!isCurrent()) {
    return { status: 'superseded' }
  }

  if (readResult.status === 'found') {
    return await confirmRequestedFile(readResult.document)
  }

  const resolvedContentPath = resolveContentPath()
  if (resolvedContentPath !== requestedContentPath) {
    return { status: 'retarget', contentPath: resolvedContentPath }
  }

  return { status: 'missing' }
}
