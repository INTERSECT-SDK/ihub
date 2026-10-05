/* eslint-disable @typescript-eslint/no-require-imports -- Node's direct TS test runner needs require() for source-inspection tests without changing package module settings. */
const { readFileSync }: typeof import('node:fs') = require('node:fs')
const { join }: typeof import('node:path') = require('node:path')
const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')

const nodeStatusBadgeSource = readFileSync(
  join(__dirname, 'NodeStatusBadge.tsx'),
  'utf8',
)
const baseNodeSource = readFileSync(join(__dirname, 'BaseNode.tsx'), 'utf8')
const campaignPresentationSource = readFileSync(
  join(__dirname, '../../editor/CampaignPresentation.tsx'),
  'utf8',
)
const campaignStylesSource = readFileSync(
  join(__dirname, '../../editor/styles.module.css'),
  'utf8',
)

test('campaign status badges render complete statuses as green', () => {
  assert.match(
    nodeStatusBadgeSource,
    /complete:\s*\{\s*label:\s*'Complete',\s*color:\s*'green'\s*\}/,
  )
  assert.match(
    campaignPresentationSource,
    /if \(status === 'complete'\) return 'green'/,
  )
  assert.match(
    campaignStylesSource,
    /\.taskGroupTabStatusIndicator\[data-status='complete'\]\s*\{\s*background-color:\s*var\(--mantine-color-green-6\);\s*\}/,
  )
})

test('NodeStatusBadge renders aborted statuses as red', () => {
  assert.match(
    nodeStatusBadgeSource,
    /aborted:\s*\{\s*label:\s*'Aborted',\s*color:\s*'red'\s*\}/,
  )
})

test('NodeStatusBadge displays how many node runs have started', () => {
  assert.match(nodeStatusBadgeSource, /` · Run \$\{runCount\}`/)
  assert.match(baseNodeSource, /runCount=\{nodeRunCount\}/)
})
