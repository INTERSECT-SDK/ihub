/* eslint-disable @typescript-eslint/no-require-imports -- Source checks avoid adding a DOM test environment. */
const { readFileSync }: typeof import('node:fs') = require('node:fs')
const { join }: typeof import('node:path') = require('node:path')
const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')

const sidePanelSource = readFileSync(
  join(__dirname, 'CampaignSidePanel.tsx'),
  'utf8',
)
const campaignSource = readFileSync(join(__dirname, 'Campaign.tsx'), 'utf8')
const topMenuButtonSource = readFileSync(
  join(__dirname, '../../navigation/TopMenuButton.tsx'),
  'utf8',
)
const sheetTransitionEffectSource = campaignSource.slice(
  campaignSource.indexOf(
    'const previousSelectedSheetIdRef = useRef(selectedSheetId)',
  ),
  campaignSource.indexOf('const previousCampaignViewProvenanceRef = useRef'),
)

test('the shared side panel retains pointer and keyboard resizing accessibility', () => {
  assert.match(sidePanelSource, /clampCampaignInspectorWidth/)
  assert.match(sidePanelSource, /resizeCampaignInspectorWithKeyboard/)
  assert.match(sidePanelSource, /role='separator'/)
  assert.match(sidePanelSource, /aria-label='Resize campaign side panel'/)
  assert.match(sidePanelSource, /aria-valuenow=\{Math\.round\(width\)\}/)
})

test('Nodes List toolbar state is announced and visually active', () => {
  assert.match(campaignSource, /ariaLabel='Nodes List'/)
  assert.match(campaignSource, /pressed=\{sidePanelState\.mode !== 'closed'\}/)
  assert.match(topMenuButtonSource, /aria-pressed=\{pressed\}/)
  assert.match(topMenuButtonSource, /color=\{pressed \? 'blue' : undefined\}/)
})

test('sheet transitions clear local inspector selection without updating old graph nodes', () => {
  assert.match(
    sheetTransitionEffectSource,
    /selectionHistoryRef\.current = \[\]/,
  )
  assert.match(
    sheetTransitionEffectSource,
    /selectedFlowNodeIdsRef\.current = new Set\(\)/,
  )
  assert.match(sheetTransitionEffectSource, /selectedNodeIdRef\.current = null/)
  assert.match(sheetTransitionEffectSource, /setSelectedNodeId\(null\)/)
  assert.doesNotMatch(sheetTransitionEffectSource, /onModelNodesChange/)
})
