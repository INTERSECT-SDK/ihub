/* eslint-disable @typescript-eslint/no-require-imports -- Node's direct TS runner needs require() for sibling modules. */
const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')

const {
  buildJsonFileManifest,
  buildJsonFileContentsUrl,
  filterJsonPickerEntries,
  inferJsonValueType,
  loadJsonProjectFile,
  resolveJsonPointer,
}: typeof import('./jsonFile') = require('./jsonFile.ts')

test('builds recursive manifests with escaped JSON Pointer keys', () => {
  const value = {
    'sample/name': {
      'til~de': 3,
      enabled: true,
    },
    label: 'run one',
  }

  assert.deepEqual(buildJsonFileManifest(value), [
    { pointer: '', displayName: '$', type: 'object' },
    {
      pointer: '/sample~1name',
      displayName: 'sample/name',
      type: 'object',
    },
    {
      pointer: '/sample~1name/til~0de',
      displayName: 'sample/name › til~de',
      type: 'integer',
    },
    {
      pointer: '/sample~1name/enabled',
      displayName: 'sample/name › enabled',
      type: 'boolean',
    },
    { pointer: '/label', displayName: 'label', type: 'string' },
  ])
  assert.equal(resolveJsonPointer(value, '/sample~1name/til~0de'), 3)
})

test('infers primitives, homogeneous arrays, and unresolved arrays', () => {
  assert.equal(inferJsonValueType(null), 'null')
  assert.equal(inferJsonValueType(2), 'integer')
  assert.equal(inferJsonValueType(Number.MAX_SAFE_INTEGER), 'integer')
  assert.equal(inferJsonValueType(Number.MAX_SAFE_INTEGER + 1), null)
  assert.equal(inferJsonValueType(2.5), 'number')
  assert.equal(inferJsonValueType(['a', 'b']), 'string[]')
  assert.equal(inferJsonValueType([1, 2.5]), 'number[]')
  assert.equal(inferJsonValueType([{ a: 1 }, { b: 2 }]), 'object[]')
  assert.equal(inferJsonValueType([]), null)
  assert.equal(inferJsonValueType([1, 'two']), null)
  assert.equal(inferJsonValueType([[1], [2]]), null)

  assert.deepEqual(buildJsonFileManifest([]), [
    {
      pointer: '',
      displayName: '$',
      type: null,
      unsupportedReason:
        'Empty, heterogeneous, or nested arrays cannot be mapped.',
    },
  ])
  assert.deepEqual(buildJsonFileManifest('root value'), [
    { pointer: '', displayName: '$', type: 'string' },
  ])
  assert.deepEqual(buildJsonFileManifest(Number.MAX_SAFE_INTEGER + 1), [
    {
      pointer: '',
      displayName: '$',
      type: null,
      unsupportedReason: 'This value type cannot be mapped.',
    },
  ])
})

test('rejects missing and malformed JSON Pointers', () => {
  assert.throws(
    () => resolveJsonPointer({ value: 1 }, '/missing'),
    /does not exist/,
  )
  assert.throws(() => resolveJsonPointer({ value: 1 }, 'value'), /invalid/)
  assert.throws(() => resolveJsonPointer({ value: 1 }, '/bad~2key'), /invalid/)
})

test('filters picker entries to directories and JSON files', () => {
  const entries = [
    { name: 'nested', path: 'nested', type: 'directory' },
    { name: 'values.JSON', path: 'values.JSON', type: 'file' },
    { name: 'notes.txt', path: 'notes.txt', type: 'file' },
    { name: 'analysis.ipynb', path: 'analysis.ipynb', type: 'notebook' },
  ]

  assert.deepEqual(
    filterJsonPickerEntries(entries as never).map((entry) => entry.name),
    ['nested', 'values.JSON'],
  )
})

test('builds an encoded project-scoped URL and rejects traversal', () => {
  assert.equal(
    buildJsonFileContentsUrl('/jupyter/user/example', {
      projectId: 'project 1',
      path: 'inputs/run #1.json',
    }),
    '/jupyter/user/example/api/contents/projects/project%201/inputs/run%20%231.json',
  )
  assert.throws(
    () =>
      buildJsonFileContentsUrl('/jupyter', {
        projectId: 'one',
        path: '../other/data.json',
      }),
    /invalid/,
  )
})

test('loads valid JSON with a content hash and reports invalid JSON or missing servers', async () => {
  const reference = {
    projectId: 'project-1',
    path: 'values.json',
    jupyterServerId: 'server-1',
  }
  const servers = [
    { id: 'server-1', url: '/jupyter', token: 'secret', label: 'Files' },
  ]
  const validFetch = (async () =>
    new Response(JSON.stringify({ content: '{"value": 1}' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch

  const first = await loadJsonProjectFile(reference, servers, validFetch)
  const second = await loadJsonProjectFile(
    reference,
    servers,
    (async () =>
      new Response(JSON.stringify({ content: '{"value": 2}' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch,
  )
  assert.deepEqual(first.value, { value: 1 })
  assert.notEqual(first.contentHash, second.contentHash)

  await assert.rejects(
    () =>
      loadJsonProjectFile(
        reference,
        servers,
        (async () =>
          new Response(JSON.stringify({ content: '{bad json' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })) as typeof fetch,
      ),
    /does not contain valid JSON/,
  )
  await assert.rejects(
    () => loadJsonProjectFile(reference, [], validFetch),
    /configured Jupyter server is unavailable/,
  )
})

test('accepts safe integers and rejects nested integers outside the safe range', async () => {
  const reference = {
    projectId: 'project-1',
    path: 'values.json',
    jupyterServerId: 'server-1',
  }
  const servers = [
    { id: 'server-1', url: '/jupyter', token: 'secret', label: 'Files' },
  ]
  const fetchFile = (content: string) =>
    (async () =>
      new Response(JSON.stringify({ content }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch

  const loadedFile = await loadJsonProjectFile(
    reference,
    servers,
    fetchFile(`{"value": ${Number.MAX_SAFE_INTEGER}}`),
  )
  assert.deepEqual(loadedFile.value, { value: Number.MAX_SAFE_INTEGER })

  await assert.rejects(
    () =>
      loadJsonProjectFile(
        reference,
        servers,
        fetchFile('{"nested": [{"value": 9007199254740993}]}'),
      ),
    /outside JavaScript's safe integer range/,
  )
})
