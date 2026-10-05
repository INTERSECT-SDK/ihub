import assert from 'node:assert/strict'
import test from 'node:test'

import { createStore } from 'jotai/vanilla'

import {
  activeProjectFileEditorAtom,
  prepareActiveProjectFileRenameAtom,
} from './project-file-editor.ts'

const SERVER_IDENTITY = '/ijupyterhub/user/user@example.com'

test('prepares and releases the active matching project-file editor', async () => {
  const store = createStore()
  let prepareCalls = 0
  let releaseCalls = 0
  let pauseCalls = 0
  let resumeCalls = 0

  store.set(activeProjectFileEditorAtom, {
    registrationId: Symbol('editor'),
    serverIdentity: SERVER_IDENTITY,
    projectId: 'project-a',
    contentPath: 'projects/project-a/file.icmp',
    isBusy: () => false,
    prepareRename: async () => {
      prepareCalls += 1
      return true
    },
    pauseSharedLock: async () => {
      pauseCalls += 1
    },
    resumeSharedLock: async () => {
      resumeCalls += 1
    },
    releaseRename: () => {
      releaseCalls += 1
    },
  })

  const preparation = await store.set(
    prepareActiveProjectFileRenameAtom,
    SERVER_IDENTITY,
    'project-a',
    'projects/project-a/file.icmp',
  )

  assert.equal(prepareCalls, 1)
  assert.equal(preparation?.status, 'prepared')
  assert.ok(preparation?.status === 'prepared')
  assert.equal(pauseCalls, 1)
  assert.equal(preparation.isCurrent(), true)
  await preparation.restore()
  await preparation.restore()
  assert.equal(resumeCalls, 1)
  assert.equal(releaseCalls, 1)
})

test('ignores an active editor for a different project file', async () => {
  const store = createStore()
  let prepareCalls = 0

  store.set(activeProjectFileEditorAtom, {
    registrationId: Symbol('editor'),
    serverIdentity: SERVER_IDENTITY,
    projectId: 'project-a',
    contentPath: 'projects/project-a/other.icmp',
    isBusy: () => false,
    prepareRename: async () => {
      prepareCalls += 1
      return true
    },
    pauseSharedLock: async () => undefined,
    resumeSharedLock: async () => undefined,
    releaseRename: () => undefined,
  })

  const preparation = await store.set(
    prepareActiveProjectFileRenameAtom,
    SERVER_IDENTITY,
    'project-a',
    'projects/project-a/file.icmp',
  )

  assert.equal(preparation, null)
  assert.equal(prepareCalls, 0)
})

test('reports a busy matching editor without preparing a rename', async () => {
  const store = createStore()
  let prepareCalls = 0

  store.set(activeProjectFileEditorAtom, {
    registrationId: Symbol('busy-editor'),
    serverIdentity: SERVER_IDENTITY,
    projectId: 'project-a',
    contentPath: 'projects/project-a/file.icmp',
    isBusy: () => true,
    prepareRename: async () => {
      prepareCalls += 1
      return true
    },
    pauseSharedLock: async () => undefined,
    resumeSharedLock: async () => undefined,
    releaseRename: () => undefined,
  })

  const preparation = await store.set(
    prepareActiveProjectFileRenameAtom,
    SERVER_IDENTITY,
    'project-a',
    'projects/project-a/file.icmp',
  )

  assert.deepEqual(preparation, { status: 'busy' })
  assert.equal(prepareCalls, 0)
})

test('prepared editor freshness follows the active registration', async () => {
  const store = createStore()
  const registrationId = Symbol('prepared-editor')
  const editor = {
    registrationId,
    serverIdentity: SERVER_IDENTITY,
    projectId: 'project-a',
    contentPath: 'projects/project-a/file.icmp',
    isBusy: () => false,
    prepareRename: async () => true,
    pauseSharedLock: async () => undefined,
    resumeSharedLock: async () => undefined,
    releaseRename: () => undefined,
  }
  store.set(activeProjectFileEditorAtom, editor)

  const preparation = await store.set(
    prepareActiveProjectFileRenameAtom,
    SERVER_IDENTITY,
    'project-a',
    'projects/project-a/file.icmp',
  )

  assert.equal(preparation?.status, 'prepared')
  assert.equal(
    preparation?.status === 'prepared' && preparation.isCurrent(),
    true,
  )

  store.set(activeProjectFileEditorAtom, {
    ...editor,
    registrationId: Symbol('replacement-editor'),
  })

  assert.equal(
    preparation?.status === 'prepared' && preparation.isCurrent(),
    false,
  )
})

test('shared-lock pause failure releases the prepared editor', async () => {
  const store = createStore()
  let releaseCalls = 0

  store.set(activeProjectFileEditorAtom, {
    registrationId: Symbol('editor'),
    serverIdentity: SERVER_IDENTITY,
    projectId: 'project-a',
    contentPath: 'projects/project-a/file.icmp',
    isBusy: () => false,
    prepareRename: async () => true,
    pauseSharedLock: async () => {
      throw new Error('lock failure')
    },
    resumeSharedLock: async () => undefined,
    releaseRename: () => {
      releaseCalls += 1
    },
  })

  await assert.rejects(
    store.set(
      prepareActiveProjectFileRenameAtom,
      SERVER_IDENTITY,
      'project-a',
      'projects/project-a/file.icmp',
    ),
    /lock failure/,
  )
  assert.equal(releaseCalls, 1)
})
