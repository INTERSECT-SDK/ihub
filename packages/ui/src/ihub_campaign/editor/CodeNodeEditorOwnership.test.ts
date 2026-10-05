/* eslint-disable @typescript-eslint/no-require-imports -- Node reads TSX source without a browser renderer. */
const { readFileSync }: typeof import('node:fs') = require('node:fs')
const { join }: typeof import('node:path') = require('node:path')
const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')
const { canvasOwnsCodeNodeEditor } =
  require('./codeNodeEditorOwnership.ts') as typeof import('./codeNodeEditorOwnership')

function source(relativePath: string): string {
  return readFileSync(join(__dirname, relativePath), 'utf8')
}

test('the inspected Code node gives its canvas editor ownership to the inspector', () => {
  const campaign = source('Campaign.tsx')
  const nodeTypes = source('useCampaignNodeTypes.tsx')
  const codeNode = source('../nodes/code/CodeNode.tsx')

  assert.match(
    campaign,
    /selectedNode\?\.type === 'code' \? selectedNode\.id : null/,
  )
  assert.match(
    campaign,
    /<CodeNodeEditorOwnershipProvider\s+inspectedNodeId=\{inspectedCodeNodeId\}/,
  )
  assert.match(
    nodeTypes,
    /const canvasOwnsEditor = useCanvasCodeNodeEditorOwnership\(id\)/,
  )
  assert.match(
    nodeTypes,
    /canvasOwnsEditor \? \(\s*<JupyterCodeNode[\s\S]*?\) : \(\s*<CodeNodePassiveCard/,
  )
  const passiveCard = codeNode.slice(
    codeNode.indexOf('export function CodeNodePassiveCard'),
    codeNode.indexOf('/** Renders a campaign graph node'),
  )
  assert.doesNotMatch(passiveCard, /useCodeNodeSession|CodeNodeCells/)
})

test('selection changes do not change the React Flow Code renderer identity', () => {
  const nodeTypes = source('useCampaignNodeTypes.tsx')
  const renderCodeNode = nodeTypes.match(
    /const renderCodeNode = useCallback\([\s\S]*?\n {2}\)/,
  )?.[0]

  assert.ok(renderCodeNode)
  assert.match(renderCodeNode, /<CampaignCanvasCodeNode/)
  assert.match(renderCodeNode, /\[onDeleteTask\]/)
  assert.doesNotMatch(renderCodeNode, /inspectedNodeId|selectedNode/)
})

test('closing or switching the inspector restores the correct canvas editor', () => {
  assert.equal(canvasOwnsCodeNodeEditor('code-a', 'code-a'), false)
  assert.equal(canvasOwnsCodeNodeEditor('code-a', 'code-b'), true)

  assert.equal(canvasOwnsCodeNodeEditor(null, 'code-a'), true)
  assert.equal(canvasOwnsCodeNodeEditor(null, 'code-b'), true)

  assert.equal(canvasOwnsCodeNodeEditor('code-b', 'code-a'), true)
  assert.equal(canvasOwnsCodeNodeEditor('code-b', 'code-b'), false)
})
