import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  arrayBufferToBase64,
  buildProjectFileUploadPayload,
  buildProjectUploadTargetPath,
  encodeProjectContentsPath,
  getProjectFileUploadCompletion,
  hasOpenProjectFileEditor,
  validateProjectUploadFile,
  type ProjectFileUploadPolicy,
} from './project-file-upload.ts'

const policy: ProjectFileUploadPolicy = {
  supported_extensions: ['.icmp', '.ipynb', '.ichat', '.ivis', '.txt', '.json'],
  max_file_size_bytes: 10 * 1024 * 1024,
}

const navigatorSource = readFileSync(
  new URL('./ViewProjectFileNavigation.tsx', import.meta.url),
  'utf8',
)

test('builds root and nested upload targets', () => {
  assert.equal(
    buildProjectUploadTargetPath('projects/project-id', 'demo.txt'),
    'projects/project-id/demo.txt',
  )
  assert.equal(
    buildProjectUploadTargetPath('projects/project-id/folder', 'demo.txt'),
    'projects/project-id/folder/demo.txt',
  )
})

test('encodes reserved characters, spaces, and Unicode in each path segment', () => {
  assert.equal(
    encodeProjectContentsPath(
      'projects/project id/data #1/query? 100%/文 件.json',
    ),
    'projects/project%20id/data%20%231/query%3F%20100%25/%E6%96%87%20%E4%BB%B6.json',
  )
})

test('rejects separators and dot filenames', () => {
  for (const name of ['../demo.txt', 'folder/demo.txt', 'folder\\demo.txt']) {
    assert.equal(
      validateProjectUploadFile({ name, size: 1 }, policy),
      'Choose a file with a valid filename.',
    )
  }

  assert.equal(
    validateProjectUploadFile({ name: '.json', size: 1 }, policy),
    'Choose a file with a valid filename.',
  )
})

test('accepts supported extensions case-insensitively', () => {
  assert.equal(
    validateProjectUploadFile({ name: 'DATA.JSON', size: 1 }, policy),
    null,
  )
  assert.match(
    validateProjectUploadFile({ name: 'data.csv', size: 1 }, policy) ?? '',
    /Supported file types/,
  )
})

test('accepts the exact limit and rejects oversized files', () => {
  assert.equal(
    validateProjectUploadFile(
      { name: 'data.bin.json', size: policy.max_file_size_bytes },
      policy,
    ),
    null,
  )
  assert.equal(
    validateProjectUploadFile(
      { name: 'data.json', size: policy.max_file_size_bytes + 1 },
      policy,
    ),
    'File must be 10 MiB or smaller.',
  )
})

test('preserves binary bytes and builds the Jupyter payload', () => {
  const bytes = Uint8Array.from([0, 255, 128, 65, 10])
  assert.equal(arrayBufferToBase64(bytes.buffer), 'AP+AQQo=')
  assert.deepEqual(buildProjectFileUploadPayload(bytes.buffer), {
    type: 'file',
    format: 'base64',
    content: 'AP+AQQo=',
  })
})

test('encodes large buffers without overflowing argument limits', () => {
  const bytes = new Uint8Array(200_000)
  bytes[199_999] = 255
  const encoded = arrayBufferToBase64(bytes.buffer)
  assert.equal(encoded.length, 266_668)
  assert.equal(encoded.slice(-4), 'AP8=')
})

test('detects a target opened after the initial overwrite conflict', () => {
  const initialTabs = [
    { id: 1, title: 'Other', path: '/project/project-id/other.txt' },
  ]
  assert.equal(
    hasOpenProjectFileEditor(
      initialTabs,
      'project-id',
      'projects/project-id/demo.txt',
    ),
    false,
  )

  const latestTabs = [
    ...initialTabs,
    { id: 2, title: 'Demo', path: '/project/project-id/demo.txt' },
  ]
  assert.equal(
    hasOpenProjectFileEditor(
      latestTabs,
      'project-id',
      'projects/project-id/demo.txt',
    ),
    true,
  )
})

test('detects an encoded editor route for a reserved-character upload target', () => {
  assert.equal(
    hasOpenProjectFileEditor(
      [
        {
          id: 1,
          title: 'Reserved',
          path: '/project/project-id/folder%20%231/query%3F%20100%25/%E6%96%87.json',
        },
      ],
      'project-id',
      'projects/project-id/folder #1/query? 100%/文.json',
    ),
    true,
  )
})

test('does not block overwrite for unrelated project or file tabs', () => {
  const openTabs = [
    { id: 1, title: 'Demo', path: '/project/other-project/demo.txt' },
    { id: 2, title: 'Other', path: '/project/project-id/other.txt' },
  ]

  assert.equal(
    hasOpenProjectFileEditor(
      openTabs,
      'project-id',
      'projects/project-id/demo.txt',
    ),
    false,
  )
})

test('reports normal upload success when the listing refresh succeeds', async () => {
  const calls: string[] = []
  const completion = await getProjectFileUploadCompletion(
    'demo.txt',
    () => {
      calls.push('invalidate')
      return true
    },
    async () => {
      calls.push('refresh')
    },
  )

  assert.deepEqual(completion, {
    message: 'demo.txt uploaded.',
    mappingRemovalSucceeded: true,
  })
  assert.deepEqual(calls, ['invalidate', 'refresh'])
})

test('reports upload success after invalidation when listing refresh fails', async () => {
  const refreshError = new Error('refresh failed')
  const calls: string[] = []
  const completion = await getProjectFileUploadCompletion(
    'demo.txt',
    () => {
      calls.push('invalidate')
      return false
    },
    async () => {
      calls.push('refresh')
      throw refreshError
    },
  )

  assert.deepEqual(completion, {
    message: 'demo.txt uploaded, but the file list could not be refreshed.',
    mappingRemovalSucceeded: false,
    refreshError,
  })
  assert.deepEqual(calls, ['invalidate', 'refresh'])
})

test('successful upload and overwrite share mapping invalidation before refresh', () => {
  const uploadFunction = navigatorSource.match(
    /const uploadFile = async \([\s\S]*?\n {2}\/\*\* Revalidates editor state/,
  )

  assert.ok(uploadFunction)
  assert.match(
    uploadFunction[0],
    /if \(!response\.ok\)[\s\S]*getProjectFileUploadCompletion\([\s\S]*invalidateRenameMapping\([\s\S]*request\.refreshListing/,
  )
})
