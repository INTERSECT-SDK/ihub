/* eslint-disable @typescript-eslint/no-require-imports -- Source inspection covers the React Flow context boundary without a DOM renderer. */
const { readFileSync }: typeof import('node:fs') = require('node:fs')
const { join }: typeof import('node:path') = require('node:path')
const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')

const hookSource = readFileSync(
  join(__dirname, 'useUpstreamVariables.ts'),
  'utf8',
)
const campaignSource = readFileSync(
  join(__dirname, '../../editor/Campaign.tsx'),
  'utf8',
)

test('inspector upstream discovery provides a node id and shared React Flow store', () => {
  assert.match(hookSource, /nodeId: string/)
  assert.equal((hookSource.match(/id: nodeId/g) ?? []).length, 2)
  assert.match(campaignSource, /<ReactFlowProvider>/)
  assert.match(campaignSource, /<CampaignNodeInspector/)
})
