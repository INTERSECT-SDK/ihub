import assert from 'node:assert/strict'
import test from 'node:test'

import {
  bootstrapProjectFile,
  type ProjectFileReadResult,
} from './project-file-bootstrap.ts'

const requestedContentPath = 'projects/project-a/A.json'

function createBootstrapOptions(
  overrides: Partial<Parameters<typeof bootstrapProjectFile<string>>[0]> = {},
) {
  const calls: string[] = []
  const options: Parameters<typeof bootstrapProjectFile<string>>[0] = {
    requestedContentPath,
    createMode: false,
    readRequestedFile: async () => {
      calls.push('read')
      return { status: 'found', document: 'requested document' }
    },
    createRequestedFile: async () => {
      calls.push('create')
      return 'created document'
    },
    resolveContentPath: () => {
      calls.push('resolve')
      return requestedContentPath
    },
    invalidateRenameMapping: () => {
      calls.push('invalidate')
      return true
    },
    isCurrent: () => true,
    ...overrides,
  }

  return { calls, options }
}

test('an existing requested path wins over a stale rename mapping', async () => {
  const { calls, options } = createBootstrapOptions({
    resolveContentPath: () => {
      throw new Error('an existing path must not follow its old mapping')
    },
  })

  const result = await bootstrapProjectFile(options)

  assert.deepEqual(result, {
    status: 'loaded',
    document: 'requested document',
    mappingRemovalSucceeded: true,
  })
  assert.deepEqual(calls, ['read', 'invalidate'])
})

test('a missing requested path retargets through its rename mapping', async () => {
  const { calls, options } = createBootstrapOptions({
    readRequestedFile: async (): Promise<ProjectFileReadResult<string>> => {
      calls.push('read')
      return { status: 'missing' }
    },
    resolveContentPath: () => {
      calls.push('resolve')
      return 'projects/project-a/B.json'
    },
  })

  assert.deepEqual(await bootstrapProjectFile(options), {
    status: 'retarget',
    contentPath: 'projects/project-a/B.json',
  })
  assert.deepEqual(calls, ['read', 'resolve'])
})

test('a missing path without a mapping remains missing', async () => {
  const { calls, options } = createBootstrapOptions({
    readRequestedFile: async () => {
      calls.push('read')
      return { status: 'missing' }
    },
  })

  assert.deepEqual(await bootstrapProjectFile(options), { status: 'missing' })
  assert.deepEqual(calls, ['read', 'resolve'])
})

test('create mode ignores stale mappings and invalidates after creation', async () => {
  const { calls, options } = createBootstrapOptions({
    createMode: true,
    readRequestedFile: async () => {
      throw new Error('create mode must not read first')
    },
    resolveContentPath: () => {
      throw new Error('create mode must not follow a mapping')
    },
  })

  assert.deepEqual(await bootstrapProjectFile(options), {
    status: 'loaded',
    document: 'created document',
    mappingRemovalSucceeded: true,
  })
  assert.deepEqual(calls, ['create', 'invalidate'])
})

test('non-missing read failures neither resolve nor invalidate', async () => {
  const { calls, options } = createBootstrapOptions({
    readRequestedFile: async () => {
      calls.push('read')
      throw new Error('authorization failed')
    },
  })

  await assert.rejects(bootstrapProjectFile(options), /authorization failed/)
  assert.deepEqual(calls, ['read'])
})

test('a late read result cannot invalidate or retarget a newer route', async () => {
  let current = true
  let finishRead: ((result: ProjectFileReadResult<string>) => void) | undefined
  const read = new Promise<ProjectFileReadResult<string>>((resolve) => {
    finishRead = resolve
  })
  const { calls, options } = createBootstrapOptions({
    readRequestedFile: async () => {
      calls.push('read')
      return await read
    },
    isCurrent: () => current,
  })

  const bootstrap = bootstrapProjectFile(options)
  current = false
  finishRead?.({ status: 'missing' })

  assert.deepEqual(await bootstrap, { status: 'superseded' })
  assert.deepEqual(calls, ['read'])
})
