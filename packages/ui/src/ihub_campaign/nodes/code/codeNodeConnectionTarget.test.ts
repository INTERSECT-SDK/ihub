/* eslint-disable @typescript-eslint/no-require-imports -- Node directly executes focused TypeScript tests in this package. */
const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')

const {
  selectCodeNodeConnectionTarget,
}: typeof import('./codeNodeConnectionTarget') = require('./codeNodeConnectionTarget.ts')

type CodeNode = import('@ihub/utils/types/campaign').CodeNode

function makeCodeNode(): CodeNode {
  return {
    id: 'code-node-1',
    name: 'Analysis',
    kernel: {
      id: 'session-1',
      kernel: {
        connections: 1,
        execution_state: 'busy',
        id: 'kernel-1',
        last_activity: '2026-09-06T12:00:00Z',
        name: 'python3',
      },
      name: 'analysis',
      notebook: { path: 'analysis.ipynb', name: 'analysis.ipynb' },
      path: 'analysis.ipynb',
      type: 'notebook',
    },
    server: {
      id: 'server-1',
      url: 'https://ihub.example/jupyter',
      token: 'token-1',
      label: 'Jupyter',
    },
    cell: {
      id: 'cell-1',
      cell_type: 'code',
      source: 'print("hello")',
      outputs: [],
      execution_count: null,
      metadata: {},
    },
  }
}

function cloneCodeNode(data: CodeNode): CodeNode {
  return JSON.parse(JSON.stringify(data)) as CodeNode
}

test('JSON-cloned code-node data retains the same connection target', () => {
  const data = makeCodeNode()

  assert.deepEqual(
    selectCodeNodeConnectionTarget(cloneCodeNode(data)),
    selectCodeNodeConnectionTarget(data),
  )
})

test('cell and non-connection metadata do not change the connection target', () => {
  const data = makeCodeNode()
  const changed = cloneCodeNode(data)
  changed.cell.source = 'print("updated")'
  changed.cell.outputs = [{ output_type: 'stream', name: 'stdout', text: 'ok' }]
  changed.kernel.kernel.connections = 4
  changed.kernel.kernel.execution_state = 'idle'
  changed.kernel.kernel.last_activity = '2026-09-06T12:05:00Z'
  changed.kernel.name = 'renamed-session'
  changed.server.id = 'renamed-server'
  changed.server.label = 'Renamed Jupyter'

  assert.deepEqual(
    selectCodeNodeConnectionTarget(changed),
    selectCodeNodeConnectionTarget(data),
  )
})

test('each connection primitive changes the connection target', () => {
  const data = makeCodeNode()
  const originalTarget = selectCodeNodeConnectionTarget(data)
  const changes: Array<(changed: CodeNode) => void> = [
    (changed) => {
      changed.kernel.id = 'session-2'
    },
    (changed) => {
      changed.kernel.kernel.id = 'kernel-2'
    },
    (changed) => {
      changed.server.url = 'https://other.example/jupyter'
    },
    (changed) => {
      changed.server.token = 'token-2'
    },
  ]

  for (const applyChange of changes) {
    const changed = cloneCodeNode(data)
    applyChange(changed)
    assert.notDeepEqual(selectCodeNodeConnectionTarget(changed), originalTarget)
  }
})
