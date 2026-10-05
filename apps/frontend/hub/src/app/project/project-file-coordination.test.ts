import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildProjectFileCoordinationKey,
  normalizeProjectFileContentPath,
  normalizeProjectFileServerIdentity,
  ProjectFileCoordinator,
  ProjectFileSharedLockController,
  type ProjectFileBroadcastChannel,
  type ProjectFileLock,
  type ProjectFileLockManager,
  type ProjectFileRenameCompletion,
} from './project-file-coordination.ts'

class FakeLockManager implements ProjectFileLockManager {
  sharedOwners = 0
  sharedAcquisitions = 0
  sharedReleases = 0

  async request<T>(
    name: string,
    options: { mode: 'shared' | 'exclusive'; ifAvailable?: boolean },
    callback: (lock: ProjectFileLock | null) => Promise<T> | T,
  ): Promise<T> {
    if (options.mode === 'exclusive' && this.sharedOwners > 0) {
      return await callback(null)
    }

    const lock = { name, mode: options.mode }
    if (options.mode === 'shared') {
      this.sharedOwners += 1
      this.sharedAcquisitions += 1
    }

    try {
      return await callback(lock)
    } finally {
      if (options.mode === 'shared') {
        this.sharedOwners -= 1
        this.sharedReleases += 1
      }
    }
  }
}

class FakeStorage {
  readonly values = new Map<string, string>()
  readonly operations: string[] = []
  removeError: Error | null = null
  setError: Error | null = null

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.operations.push(`set:${key}`)
    if (this.setError) {
      throw this.setError
    }
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    this.operations.push(`remove:${key}`)
    if (this.removeError) {
      throw this.removeError
    }
    this.values.delete(key)
  }
}

function createChannelFactory() {
  const channels = new Set<{
    listeners: Set<(event: MessageEvent<unknown>) => void>
  }>()

  return (): ProjectFileBroadcastChannel => {
    const state = {
      listeners: new Set<(event: MessageEvent<unknown>) => void>(),
    }
    channels.add(state)

    return {
      addEventListener: (_type, listener) => state.listeners.add(listener),
      removeEventListener: (_type, listener) =>
        state.listeners.delete(listener),
      postMessage: (message) => {
        for (const channel of channels) {
          if (channel === state) {
            continue
          }
          for (const listener of channel.listeners) {
            listener({ data: message } as MessageEvent<unknown>)
          }
        }
      },
      close: () => channels.delete(state),
    }
  }
}

function createCoordinator() {
  const locks = new FakeLockManager()
  const storage = new FakeStorage()
  const createChannel = createChannelFactory()
  return {
    locks,
    storage,
    coordinator: new ProjectFileCoordinator({
      locks,
      storage,
      createChannel,
    }),
  }
}

test('normalizes server identity and preserves decoded logical contents paths', () => {
  assert.equal(
    normalizeProjectFileServerIdentity(
      'HTTPS://JUPYTER.EXAMPLE/ijupyterhub/user/me/',
    ),
    'https://jupyter.example/ijupyterhub/user/me',
  )
  assert.equal(
    normalizeProjectFileContentPath(
      'projects/project-a/folder%20one/demo%23file.json',
    ),
    'projects/project-a/folder%20one/demo%23file.json',
  )
  assert.equal(
    buildProjectFileCoordinationKey(
      '/ijupyterhub/user/me/',
      'project-a',
      '/projects/project-a/folder%20one/demo.json/',
    ),
    buildProjectFileCoordinationKey(
      '/ijupyterhub/user/me',
      'project-a',
      'projects/project-a/folder%20one/demo.json',
    ),
  )
})

test('remote shared ownership blocks an exclusive rename', async () => {
  const { coordinator } = createCoordinator()
  const sharedLock = await coordinator.acquireShared('document-key')

  const result = await coordinator.runExclusive('document-key', async () => {
    throw new Error('exclusive action must not run')
  })

  assert.deepEqual(result, { status: 'blocked' })
  await sharedLock.release()
})

test('local editor release permits rename and ordinary failure reacquires once', async () => {
  const { coordinator, locks } = createCoordinator()
  const controller = new ProjectFileSharedLockController(
    coordinator,
    'document-key',
  )

  await controller.acquire()
  assert.equal(locks.sharedOwners, 1)
  await controller.release()
  assert.equal(locks.sharedOwners, 0)

  const result = await coordinator.runExclusive('document-key', async () => 42)
  assert.deepEqual(result, { status: 'completed', value: 42 })

  await controller.acquire()
  await controller.acquire()
  assert.equal(locks.sharedOwners, 1)
  assert.equal(locks.sharedAcquisitions, 2)
  await controller.dispose()
  await controller.dispose()
  assert.equal(locks.sharedOwners, 0)
  assert.equal(locks.sharedReleases, 2)
})

test('overlapping cleanup and remount reacquires shared ownership', async () => {
  const { coordinator, locks } = createCoordinator()
  const controller = new ProjectFileSharedLockController(
    coordinator,
    'document-key',
  )

  const firstAcquire = controller.acquire()
  const cleanup = controller.release()
  const remount = controller.acquire()
  await Promise.all([firstAcquire, cleanup, remount])

  assert.equal(locks.sharedOwners, 1)
  assert.equal(locks.sharedAcquisitions, 2)
  assert.equal(locks.sharedReleases, 1)

  await controller.dispose()
  assert.equal(locks.sharedOwners, 0)
  assert.equal(locks.sharedReleases, 2)
})

test('publishes completion and resolves persisted old paths across contexts', () => {
  const { coordinator } = createCoordinator()
  const received: ProjectFileRenameCompletion[] = []
  const unsubscribe = coordinator.subscribe((completion) =>
    received.push(completion),
  )
  const completion: ProjectFileRenameCompletion = {
    type: 'project-file-renamed',
    serverIdentity: '/ijupyterhub/user/me',
    projectId: 'project-a',
    oldContentPath: 'projects/project-a/folder/original.json',
    newContentPath: 'projects/project-a/folder/renamed.json',
    newFilename: 'renamed.json',
  }

  assert.deepEqual(coordinator.publishRename(completion), {
    persistentMappingSucceeded: true,
    broadcastSucceeded: true,
    failedStages: [],
  })

  assert.deepEqual(received, [completion])
  assert.equal(
    coordinator.resolveContentPath(
      completion.serverIdentity,
      completion.projectId,
      completion.oldContentPath,
    ),
    completion.newContentPath,
  )
  unsubscribe()
})

test('removes the destination mapping before storing rename completion', () => {
  const { coordinator, storage } = createCoordinator()
  const completion: ProjectFileRenameCompletion = {
    type: 'project-file-renamed',
    serverIdentity: '/ijupyterhub/user/me',
    projectId: 'project-a',
    oldContentPath: 'projects/project-a/A.json',
    newContentPath: 'projects/project-a/B.json',
    newFilename: 'B.json',
  }

  coordinator.publishRename(completion)

  assert.deepEqual(storage.operations, [
    `remove:ihub-project-file-rename-v1:${buildProjectFileCoordinationKey(
      completion.serverIdentity,
      completion.projectId,
      completion.newContentPath,
    )}`,
    `set:ihub-project-file-rename-v1:${buildProjectFileCoordinationKey(
      completion.serverIdentity,
      completion.projectId,
      completion.oldContentPath,
    )}`,
  ])
})

test('renaming A to B and back keeps A authoritative without a cycle', () => {
  const { coordinator, locks, storage } = createCoordinator()
  const firstCompletion: ProjectFileRenameCompletion = {
    type: 'project-file-renamed',
    serverIdentity: '/ijupyterhub/user/me',
    projectId: 'project-a',
    oldContentPath: 'projects/project-a/A.json',
    newContentPath: 'projects/project-a/B.json',
    newFilename: 'B.json',
  }
  const secondCompletion: ProjectFileRenameCompletion = {
    ...firstCompletion,
    oldContentPath: firstCompletion.newContentPath,
    newContentPath: firstCompletion.oldContentPath,
    newFilename: 'A.json',
  }

  coordinator.publishRename(firstCompletion)
  coordinator.publishRename(secondCompletion)

  const freshCoordinator = new ProjectFileCoordinator({
    locks,
    storage,
    createChannel: createChannelFactory(),
  })
  assert.equal(
    freshCoordinator.resolveContentPath(
      secondCompletion.serverIdentity,
      secondCompletion.projectId,
      secondCompletion.newContentPath,
    ),
    secondCompletion.newContentPath,
  )
  assert.equal(
    freshCoordinator.resolveContentPath(
      secondCompletion.serverIdentity,
      secondCompletion.projectId,
      secondCompletion.oldContentPath,
    ),
    secondCompletion.newContentPath,
  )
})

test('invalidating a renamed source makes the reused path authoritative', () => {
  const { coordinator } = createCoordinator()
  const completion: ProjectFileRenameCompletion = {
    type: 'project-file-renamed',
    serverIdentity: '/ijupyterhub/user/me',
    projectId: 'project-a',
    oldContentPath: 'projects/project-a/A.json',
    newContentPath: 'projects/project-a/B.json',
    newFilename: 'B.json',
  }
  coordinator.publishRename(completion)

  assert.equal(
    coordinator.invalidateRenameMapping(
      completion.serverIdentity,
      completion.projectId,
      `/projects/project-a/A.json/`,
    ),
    true,
  )
  assert.equal(
    coordinator.resolveContentPath(
      completion.serverIdentity,
      completion.projectId,
      completion.oldContentPath,
    ),
    completion.oldContentPath,
  )
})

test('invalidating one source does not remove unrelated rename mappings', () => {
  const { coordinator } = createCoordinator()
  const completionA: ProjectFileRenameCompletion = {
    type: 'project-file-renamed',
    serverIdentity: '/ijupyterhub/user/me',
    projectId: 'project-a',
    oldContentPath: 'projects/project-a/A.json',
    newContentPath: 'projects/project-a/B.json',
    newFilename: 'B.json',
  }
  const completionC: ProjectFileRenameCompletion = {
    ...completionA,
    oldContentPath: 'projects/project-a/C.json',
    newContentPath: 'projects/project-a/D.json',
    newFilename: 'D.json',
  }
  coordinator.publishRename(completionA)
  coordinator.publishRename(completionC)

  coordinator.invalidateRenameMapping(
    completionA.serverIdentity,
    completionA.projectId,
    completionA.oldContentPath,
  )

  assert.equal(
    coordinator.resolveContentPath(
      completionC.serverIdentity,
      completionC.projectId,
      completionC.oldContentPath,
    ),
    completionC.newContentPath,
  )
})

test('invalidating an intermediate path stops a rename chain there', () => {
  const { coordinator } = createCoordinator()
  const completionA: ProjectFileRenameCompletion = {
    type: 'project-file-renamed',
    serverIdentity: '/ijupyterhub/user/me',
    projectId: 'project-a',
    oldContentPath: 'projects/project-a/A.json',
    newContentPath: 'projects/project-a/B.json',
    newFilename: 'B.json',
  }
  const completionB: ProjectFileRenameCompletion = {
    ...completionA,
    oldContentPath: completionA.newContentPath,
    newContentPath: 'projects/project-a/C.json',
    newFilename: 'C.json',
  }
  coordinator.publishRename(completionA)
  coordinator.publishRename(completionB)
  coordinator.invalidateRenameMapping(
    completionB.serverIdentity,
    completionB.projectId,
    completionB.oldContentPath,
  )

  assert.equal(
    coordinator.resolveContentPath(
      completionA.serverIdentity,
      completionA.projectId,
      completionA.oldContentPath,
    ),
    completionA.newContentPath,
  )
})

test('in-memory invalidation survives persistent removal failure', () => {
  const { coordinator, storage } = createCoordinator()
  const completion: ProjectFileRenameCompletion = {
    type: 'project-file-renamed',
    serverIdentity: '/ijupyterhub/user/me',
    projectId: 'project-a',
    oldContentPath: 'projects/project-a/A.json',
    newContentPath: 'projects/project-a/B.json',
    newFilename: 'B.json',
  }
  coordinator.publishRename(completion)
  storage.removeError = new Error('storage unavailable')

  assert.equal(
    coordinator.invalidateRenameMapping(
      completion.serverIdentity,
      completion.projectId,
      completion.oldContentPath,
    ),
    false,
  )
  assert.equal(
    coordinator.resolveContentPath(
      completion.serverIdentity,
      completion.projectId,
      completion.oldContentPath,
    ),
    completion.oldContentPath,
  )
})

test('a later successful rename reactivates an invalidated source mapping', () => {
  const { coordinator } = createCoordinator()
  const firstCompletion: ProjectFileRenameCompletion = {
    type: 'project-file-renamed',
    serverIdentity: '/ijupyterhub/user/me',
    projectId: 'project-a',
    oldContentPath: 'projects/project-a/A.json',
    newContentPath: 'projects/project-a/B.json',
    newFilename: 'B.json',
  }
  coordinator.publishRename(firstCompletion)
  coordinator.invalidateRenameMapping(
    firstCompletion.serverIdentity,
    firstCompletion.projectId,
    firstCompletion.oldContentPath,
  )

  const laterCompletion = {
    ...firstCompletion,
    newContentPath: 'projects/project-a/C.json',
    newFilename: 'C.json',
  }
  coordinator.publishRename(laterCompletion)

  assert.equal(
    coordinator.resolveContentPath(
      laterCompletion.serverIdentity,
      laterCompletion.projectId,
      laterCompletion.oldContentPath,
    ),
    laterCompletion.newContentPath,
  )
})

test('storage failure does not prevent rename broadcast or escape', () => {
  const { coordinator, storage } = createCoordinator()
  const received: ProjectFileRenameCompletion[] = []
  const unsubscribe = coordinator.subscribe((completion) =>
    received.push(completion),
  )
  const completion: ProjectFileRenameCompletion = {
    type: 'project-file-renamed',
    serverIdentity: '/ijupyterhub/user/me',
    projectId: 'project-a',
    oldContentPath: 'projects/project-a/A.json',
    newContentPath: 'projects/project-a/B.json',
    newFilename: 'B.json',
  }
  storage.setError = new Error('storage unavailable')

  assert.deepEqual(coordinator.publishRename(completion), {
    persistentMappingSucceeded: false,
    broadcastSucceeded: true,
    failedStages: ['persistent-mapping'],
  })
  assert.deepEqual(storage.operations, [
    `remove:ihub-project-file-rename-v1:${buildProjectFileCoordinationKey(
      completion.serverIdentity,
      completion.projectId,
      completion.newContentPath,
    )}`,
    `set:ihub-project-file-rename-v1:${buildProjectFileCoordinationKey(
      completion.serverIdentity,
      completion.projectId,
      completion.oldContentPath,
    )}`,
  ])
  assert.equal(storage.values.size, 0)
  assert.deepEqual(received, [completion])
  assert.equal(
    coordinator.resolveContentPath(
      completion.serverIdentity,
      completion.projectId,
      completion.oldContentPath,
    ),
    completion.oldContentPath,
  )
  assert.equal(
    coordinator.resolveContentPath(
      completion.serverIdentity,
      completion.projectId,
      completion.newContentPath,
    ),
    completion.newContentPath,
  )
  unsubscribe()
})

test('destination cleanup failure skips storage and still broadcasts', () => {
  const { coordinator, storage } = createCoordinator()
  const completion: ProjectFileRenameCompletion = {
    type: 'project-file-renamed',
    serverIdentity: '/ijupyterhub/user/me',
    projectId: 'project-a',
    oldContentPath: 'projects/project-a/A.json',
    newContentPath: 'projects/project-a/B.json',
    newFilename: 'B.json',
  }
  coordinator.publishRename({
    ...completion,
    oldContentPath: completion.newContentPath,
    newContentPath: 'projects/project-a/C.json',
    newFilename: 'C.json',
  })
  storage.operations.length = 0
  const received: ProjectFileRenameCompletion[] = []
  const unsubscribe = coordinator.subscribe((completion) =>
    received.push(completion),
  )
  storage.removeError = new Error('storage unavailable')

  assert.deepEqual(coordinator.publishRename(completion), {
    persistentMappingSucceeded: false,
    broadcastSucceeded: true,
    failedStages: ['persistent-mapping'],
  })
  assert.equal(
    storage.operations.some((operation) => operation.startsWith('set:')),
    false,
  )
  assert.equal(storage.values.size, 1)
  assert.deepEqual(received, [completion])
  assert.equal(
    coordinator.resolveContentPath(
      completion.serverIdentity,
      completion.projectId,
      completion.oldContentPath,
    ),
    completion.oldContentPath,
  )
  assert.equal(
    coordinator.resolveContentPath(
      completion.serverIdentity,
      completion.projectId,
      completion.newContentPath,
    ),
    completion.newContentPath,
  )
  unsubscribe()
})

test('channel construction failure does not prevent persistent publication', () => {
  const locks = new FakeLockManager()
  const storage = new FakeStorage()
  let channelCreationAttempts = 0
  const coordinator = new ProjectFileCoordinator({
    locks,
    storage,
    createChannel: () => {
      channelCreationAttempts += 1
      throw new Error('channel unavailable')
    },
  })
  const completion: ProjectFileRenameCompletion = {
    type: 'project-file-renamed',
    serverIdentity: '/ijupyterhub/user/me',
    projectId: 'project-a',
    oldContentPath: 'projects/project-a/A.json',
    newContentPath: 'projects/project-a/B.json',
    newFilename: 'B.json',
  }

  assert.deepEqual(coordinator.publishRename(completion), {
    persistentMappingSucceeded: true,
    broadcastSucceeded: false,
    failedStages: ['broadcast-channel'],
  })
  assert.equal(channelCreationAttempts, 1)
  assert.equal(
    coordinator.resolveContentPath(
      completion.serverIdentity,
      completion.projectId,
      completion.oldContentPath,
    ),
    completion.newContentPath,
  )
})

test('postMessage failure still closes the channel and reports the stage', () => {
  const locks = new FakeLockManager()
  const storage = new FakeStorage()
  let closeAttempts = 0
  const coordinator = new ProjectFileCoordinator({
    locks,
    storage,
    createChannel: () => ({
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      postMessage: () => {
        throw new Error('broadcast unavailable')
      },
      close: () => {
        closeAttempts += 1
      },
    }),
  })
  const completion: ProjectFileRenameCompletion = {
    type: 'project-file-renamed',
    serverIdentity: '/ijupyterhub/user/me',
    projectId: 'project-a',
    oldContentPath: 'projects/project-a/A.json',
    newContentPath: 'projects/project-a/B.json',
    newFilename: 'B.json',
  }

  assert.deepEqual(coordinator.publishRename(completion), {
    persistentMappingSucceeded: true,
    broadcastSucceeded: false,
    failedStages: ['broadcast-message'],
  })
  assert.equal(closeAttempts, 1)
})

test('channel cleanup failure does not escape after a successful broadcast', () => {
  const locks = new FakeLockManager()
  const storage = new FakeStorage()
  let postedCompletion: unknown
  const coordinator = new ProjectFileCoordinator({
    locks,
    storage,
    createChannel: () => ({
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      postMessage: (completion) => {
        postedCompletion = completion
      },
      close: () => {
        throw new Error('channel cleanup unavailable')
      },
    }),
  })
  const completion: ProjectFileRenameCompletion = {
    type: 'project-file-renamed',
    serverIdentity: '/ijupyterhub/user/me',
    projectId: 'project-a',
    oldContentPath: 'projects/project-a/A.json',
    newContentPath: 'projects/project-a/B.json',
    newFilename: 'B.json',
  }

  assert.deepEqual(coordinator.publishRename(completion), {
    persistentMappingSucceeded: true,
    broadcastSucceeded: true,
    failedStages: ['channel-cleanup'],
  })
  assert.equal(postedCompletion, completion)
})

test('unsupported coordinator rejects unsafe lock operations', async () => {
  const coordinator = new ProjectFileCoordinator({})

  assert.equal(coordinator.supported, false)
  assert.deepEqual(
    await coordinator.runExclusive('document-key', async () => true),
    { status: 'unsupported' },
  )
  await assert.rejects(() => coordinator.acquireShared('document-key'))
})
