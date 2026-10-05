/* eslint-disable @typescript-eslint/no-require-imports -- Node's direct TS test runner needs require() for source-inspection tests without changing package module settings. */
const { readFileSync }: typeof import('node:fs') = require('node:fs')
const { join }: typeof import('node:path') = require('node:path')
const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')

const baseCampaignEdgeSource = readFileSync(
  join(__dirname, 'BaseCampaignEdge.tsx'),
  'utf8',
)

test('BaseCampaignEdge exposes a centered hover delete action', () => {
  assert.match(
    baseCampaignEdgeSource,
    /const \[edgePath, labelX, labelY\] = getSmoothStepPath/,
  )
  assert.match(
    baseCampaignEdgeSource,
    /onMouseEnter=\{\(\) => setIsHovered\(true\)\}/,
  )
  assert.match(baseCampaignEdgeSource, /<EdgeLabelRenderer>/)
  assert.match(baseCampaignEdgeSource, /aria-label='Delete edge'/)
  assert.match(baseCampaignEdgeSource, /<IHubIconTrash size=\{16\} \/>/)
})

test('BaseCampaignEdge confirms deletion in mutable views', () => {
  assert.match(
    baseCampaignEdgeSource,
    /const \{ readOnly \} = useCampaignView\(\)/,
  )
  assert.match(
    baseCampaignEdgeSource,
    /const canDelete = !readOnly && deletable !== false/,
  )
  assert.match(
    baseCampaignEdgeSource,
    /void deleteElements\(\{ edges: \[\{ id \}\] \}\)/,
  )
  assert.match(baseCampaignEdgeSource, /<Text size='sm'>Delete edge\?<\/Text>/)
  assert.match(baseCampaignEdgeSource, /aria-label='Confirm delete edge'/)
  assert.match(baseCampaignEdgeSource, /aria-label='Cancel delete edge'/)
  assert.match(baseCampaignEdgeSource, /setIsConfirmingDelete\(true\)/)
  assert.match(baseCampaignEdgeSource, /setIsConfirmingDelete\(false\)/)
  assert.match(baseCampaignEdgeSource, /event\.stopPropagation\(\)/)
})
