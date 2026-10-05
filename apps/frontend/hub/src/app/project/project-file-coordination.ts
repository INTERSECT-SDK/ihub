/**
 * Coordinates cross-tab and same-tab project file rename safety by normalizing
 * file identities, managing shared/exclusive Web Locks, and broadcasting rename
 * completion events so open file views stay consistent.
 */
const PROJECT_FILE_RENAME_CHANNEL = 'ihub-project-file-renames-v1'
const PROJECT_FILE_RENAME_STORAGE_PREFIX = 'ihub-project-file-rename-v1:'

export const PROJECT_FILE_COORDINATION_UNSUPPORTED_ERROR =
  'Renaming project files requires a browser with Web Locks and BroadcastChannel support.'
export const PROJECT_FILE_OPEN_IN_OTHER_CONTEXT_ERROR =
  'Close this file in the other browser window or tab before renaming it.'

type ProjectFileLockMode = 'shared' | 'exclusive'

export interface ProjectFileLock {
  name: string
  mode: ProjectFileLockMode
}

export interface ProjectFileLockManager {
  request<T>(
    name: string,
    options: { mode: ProjectFileLockMode; ifAvailable?: boolean },
    callback: (lock: ProjectFileLock | null) => Promise<T> | T,
  ): Promise<T>
}

export interface ProjectFileBroadcastChannel {
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<unknown>) => void,
  ): void
  removeEventListener(
    type: 'message',
    listener: (event: MessageEvent<unknown>) => void,
  ): void
  postMessage(message: unknown): void
  close(): void
}

export interface ProjectFileRenameCompletion {
  type: 'project-file-renamed'
  serverIdentity: string
  projectId: string
  oldContentPath: string
  newContentPath: string
  newFilename: string
}

export type ProjectFileRenamePublicationStage =
  | 'persistent-mapping'
  | 'broadcast-channel'
  | 'broadcast-message'
  | 'channel-cleanup'

export interface ProjectFileRenamePublicationResult {
  persistentMappingSucceeded: boolean
  broadcastSucceeded: boolean
  failedStages: ProjectFileRenamePublicationStage[]
}

export interface ProjectFileSharedLockHandle {
  release: () => Promise<void>
}

export type ProjectFileExclusiveResult<T> =
  | { status: 'unsupported' }
  | { status: 'blocked' }
  | { status: 'completed'; value: T }

interface ProjectFileStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

interface ProjectFileCoordinatorDependencies {
  locks?: ProjectFileLockManager
  createChannel?: (name: string) => ProjectFileBroadcastChannel
  storage?: ProjectFileStorage
}

/** Normalize a Jupyter contents path without changing its segment structure. */
export function normalizeProjectFileContentPath(contentPath: string): string {
  return contentPath.replace(/^\/+|\/+$/g, '')
}

/** Normalize a Jupyter server URL for stable browser-context lock keys. */
export function normalizeProjectFileServerIdentity(serverUrl: string): string {
  const trimmedUrl = serverUrl.trim().replace(/\/+$/, '')
  if (!trimmedUrl || trimmedUrl.startsWith('/')) {
    return trimmedUrl
  }

  try {
    const parsedUrl = new URL(trimmedUrl)
    return `${parsedUrl.protocol.toLowerCase()}//${parsedUrl.host.toLowerCase()}${parsedUrl.pathname.replace(/\/+$/, '')}`
  } catch {
    return trimmedUrl
  }
}

/** Build the lock/storage key shared by every context editing the same file. */
export function buildProjectFileCoordinationKey(
  serverIdentity: string,
  projectId: string,
  contentPath: string,
): string {
  return [
    'ihub-project-file',
    encodeURIComponent(normalizeProjectFileServerIdentity(serverIdentity)),
    encodeURIComponent(projectId),
    encodeURIComponent(normalizeProjectFileContentPath(contentPath)),
  ].join(':')
}

function isProjectFileRenameCompletion(
  value: unknown,
): value is ProjectFileRenameCompletion {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<ProjectFileRenameCompletion>
  return (
    candidate.type === 'project-file-renamed' &&
    typeof candidate.serverIdentity === 'string' &&
    typeof candidate.projectId === 'string' &&
    typeof candidate.oldContentPath === 'string' &&
    typeof candidate.newContentPath === 'string' &&
    typeof candidate.newFilename === 'string'
  )
}

/**
 * Coordinates project-file ownership and rename completion across browser
 * contexts using Web Locks, BroadcastChannel, and localStorage.
 */
export class ProjectFileCoordinator {
  readonly supported: boolean

  private readonly locks?: ProjectFileLockManager
  private readonly createChannel?: (name: string) => ProjectFileBroadcastChannel
  private readonly storage?: ProjectFileStorage
  private readonly invalidatedRenameKeys = new Set<string>()

  constructor({
    locks,
    createChannel,
    storage,
  }: ProjectFileCoordinatorDependencies) {
    this.locks = locks
    this.createChannel = createChannel
    this.storage = storage
    this.supported = Boolean(locks && createChannel && storage)
  }

  /** Hold a shared ownership lock until the returned handle is released. */
  async acquireShared(
    coordinationKey: string,
  ): Promise<ProjectFileSharedLockHandle> {
    if (!this.locks) {
      throw new Error(PROJECT_FILE_COORDINATION_UNSUPPORTED_ERROR)
    }

    let resolveAcquired: (() => void) | undefined
    let rejectAcquired: ((error: unknown) => void) | undefined
    const acquired = new Promise<void>((resolve, reject) => {
      resolveAcquired = resolve
      rejectAcquired = reject
    })
    let resolveRelease: (() => void) | undefined
    const released = new Promise<void>((resolve) => {
      resolveRelease = resolve
    })

    const request = this.locks.request(
      coordinationKey,
      { mode: 'shared' },
      async (lock) => {
        if (!lock) {
          throw new Error('Unable to acquire the project-file editor lock.')
        }

        resolveAcquired?.()
        await released
      },
    )
    request.catch((error: unknown) => rejectAcquired?.(error))
    await acquired

    let didRelease = false
    return {
      release: async () => {
        if (didRelease) {
          return
        }

        didRelease = true
        resolveRelease?.()
        await request
      },
    }
  }

  /** Run a rename only when no other browser context owns the source file. */
  async runExclusive<T>(
    coordinationKey: string,
    action: () => Promise<T>,
  ): Promise<ProjectFileExclusiveResult<T>> {
    if (!this.locks || !this.supported) {
      return { status: 'unsupported' }
    }

    let acquired = false
    const value = await this.locks.request(
      coordinationKey,
      { mode: 'exclusive', ifAvailable: true },
      async (lock) => {
        if (!lock) {
          return undefined
        }

        acquired = true
        return await action()
      },
    )

    return acquired
      ? { status: 'completed', value: value as T }
      : { status: 'blocked' }
  }

  /**
   * Best-effort persist and broadcast a completed rename before the exclusive
   * lock is released, reporting each failed browser publication stage.
   */
  publishRename(
    completion: ProjectFileRenameCompletion,
  ): ProjectFileRenamePublicationResult {
    const oldKey = buildProjectFileCoordinationKey(
      completion.serverIdentity,
      completion.projectId,
      completion.oldContentPath,
    )
    const newKey = buildProjectFileCoordinationKey(
      completion.serverIdentity,
      completion.projectId,
      completion.newContentPath,
    )
    const storageKey = `${PROJECT_FILE_RENAME_STORAGE_PREFIX}${oldKey}`
    const destinationStorageKey = `${PROJECT_FILE_RENAME_STORAGE_PREFIX}${newKey}`
    const failedStages: ProjectFileRenamePublicationStage[] = []
    let persistentMappingSucceeded = false

    // Keep both paths authoritative in memory unless the complete persistent
    // cleanup-and-store operation succeeds.
    this.invalidatedRenameKeys.add(oldKey)
    this.invalidatedRenameKeys.add(newKey)

    if (this.storage) {
      try {
        this.storage.removeItem(destinationStorageKey)
        this.storage.setItem(storageKey, JSON.stringify(completion))
        this.invalidatedRenameKeys.delete(oldKey)
        persistentMappingSucceeded = true
      } catch {
        failedStages.push('persistent-mapping')
      }
    } else {
      failedStages.push('persistent-mapping')
    }

    let channel: ProjectFileBroadcastChannel | undefined
    let broadcastSucceeded = false
    if (this.createChannel) {
      try {
        channel = this.createChannel(PROJECT_FILE_RENAME_CHANNEL)
      } catch {
        failedStages.push('broadcast-channel')
      }
    } else {
      failedStages.push('broadcast-channel')
    }

    if (channel) {
      try {
        channel.postMessage(completion)
        broadcastSucceeded = true
      } catch {
        failedStages.push('broadcast-message')
      }

      try {
        channel.close()
      } catch {
        failedStages.push('channel-cleanup')
      }
    }

    return {
      persistentMappingSucceeded,
      broadcastSucceeded,
      failedStages,
    }
  }

  /**
   * Make a verified source path authoritative over its persisted rename
   * mapping. The in-memory invalidation remains effective if storage removal
   * fails for the lifetime of this coordinator.
   */
  invalidateRenameMapping(
    serverIdentity: string,
    projectId: string,
    contentPath: string,
  ): boolean {
    const coordinationKey = buildProjectFileCoordinationKey(
      serverIdentity,
      projectId,
      contentPath,
    )
    this.invalidatedRenameKeys.add(coordinationKey)

    if (!this.storage) {
      return false
    }

    try {
      this.storage.removeItem(
        `${PROJECT_FILE_RENAME_STORAGE_PREFIX}${coordinationKey}`,
      )
      return true
    } catch {
      return false
    }
  }

  /** Subscribe to rename completions published by other browser contexts. */
  subscribe(
    listener: (completion: ProjectFileRenameCompletion) => void,
  ): () => void {
    if (!this.createChannel) {
      return () => undefined
    }

    const channel = this.createChannel(PROJECT_FILE_RENAME_CHANNEL)
    const handleMessage = (event: MessageEvent<unknown>) => {
      if (isProjectFileRenameCompletion(event.data)) {
        listener(event.data)
      }
    }
    channel.addEventListener('message', handleMessage)

    return () => {
      channel.removeEventListener('message', handleMessage)
      channel.close()
    }
  }

  /** Resolve a stale project contents path through persisted rename mappings. */
  resolveContentPath(
    serverIdentity: string,
    projectId: string,
    contentPath: string,
  ): string {
    if (!this.storage) {
      return normalizeProjectFileContentPath(contentPath)
    }

    const normalizedServerIdentity =
      normalizeProjectFileServerIdentity(serverIdentity)
    let resolvedPath = normalizeProjectFileContentPath(contentPath)
    const visitedPaths = new Set<string>()

    while (!visitedPaths.has(resolvedPath)) {
      visitedPaths.add(resolvedPath)
      const key = buildProjectFileCoordinationKey(
        normalizedServerIdentity,
        projectId,
        resolvedPath,
      )
      if (this.invalidatedRenameKeys.has(key)) {
        break
      }

      const storedCompletion = this.storage.getItem(
        `${PROJECT_FILE_RENAME_STORAGE_PREFIX}${key}`,
      )
      if (!storedCompletion) {
        break
      }

      try {
        const parsedCompletion = JSON.parse(storedCompletion) as unknown
        if (
          !isProjectFileRenameCompletion(parsedCompletion) ||
          normalizeProjectFileServerIdentity(
            parsedCompletion.serverIdentity,
          ) !== normalizedServerIdentity ||
          parsedCompletion.projectId !== projectId ||
          normalizeProjectFileContentPath(parsedCompletion.oldContentPath) !==
            resolvedPath
        ) {
          break
        }

        resolvedPath = normalizeProjectFileContentPath(
          parsedCompletion.newContentPath,
        )
      } catch {
        break
      }
    }

    return resolvedPath
  }
}

/**
 * Manages one mounted editor's shared lock across prepare/failure/unmount
 * transitions.
 */
export class ProjectFileSharedLockController {
  private handle: ProjectFileSharedLockHandle | null = null
  private transition: Promise<void> = Promise.resolve()
  private disposed = false
  private readonly coordinator: ProjectFileCoordinator
  private readonly coordinationKey: string

  constructor(coordinator: ProjectFileCoordinator, coordinationKey: string) {
    this.coordinator = coordinator
    this.coordinationKey = coordinationKey
  }

  async acquire(): Promise<void> {
    await this.enqueue(async () => {
      if (this.disposed || this.handle) {
        return
      }

      this.handle = await this.coordinator.acquireShared(this.coordinationKey)
    })
  }

  async release(): Promise<void> {
    await this.enqueue(async () => {
      const handle = this.handle
      this.handle = null
      await handle?.release()
    })
  }

  async dispose(): Promise<void> {
    this.disposed = true
    await this.release()
  }

  private enqueue(action: () => Promise<void>): Promise<void> {
    const operation = this.transition.catch(() => undefined).then(action)
    this.transition = operation.catch(() => undefined)
    return operation
  }
}

/** Create a coordinator backed by the current browser's native primitives. */
export function createBrowserProjectFileCoordinator(): ProjectFileCoordinator {
  const locks =
    typeof navigator !== 'undefined' && navigator.locks
      ? (navigator.locks as ProjectFileLockManager)
      : undefined
  const createChannel =
    typeof BroadcastChannel !== 'undefined'
      ? (name: string) => new BroadcastChannel(name)
      : undefined
  let storage: Storage | undefined
  try {
    storage = typeof window !== 'undefined' ? window.localStorage : undefined
  } catch {
    storage = undefined
  }

  return new ProjectFileCoordinator({
    locks,
    createChannel,
    storage,
  })
}
