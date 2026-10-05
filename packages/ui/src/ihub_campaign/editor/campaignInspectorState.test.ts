/* eslint-disable @typescript-eslint/no-require-imports -- The focused Node runner loads TypeScript directly. */
const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')

const {
  CAMPAIGN_INSPECTOR_RESIZE_STEP,
  campaignInspectorNodeTypeKeys,
  clampCampaignInspectorWidth,
  getCampaignInspectorNodeIdAfterClick,
  getCampaignInspectorNodeIdAfterSelection,
  leaveCampaignInspector,
  openCampaignNodesList,
  reconcileCampaignPanelAfterSelectionClear,
  reconcileCampaignPanelAfterSheetChange,
  resizeCampaignInspectorWithKeyboard,
  selectCampaignInspectorNodeId,
  toggleCampaignAllNodesPanel,
}: typeof import('./campaignInspectorState') = require('./campaignInspectorState.ts')

test('inspector registry covers every supported task node type', () => {
  assert.deepEqual(campaignInspectorNodeTypeKeys, [
    'capability',
    'event',
    'code',
    'visualization',
    'image-renderer',
    'text-renderer',
    'json-file',
    'json-text',
  ])
})

test('selection chooses the most recently selected supported task', () => {
  const nodes = [
    { id: 'group', type: 'taskGroup' },
    { id: 'event', type: 'event' },
    { id: 'code', type: 'code' },
  ] as never[]

  assert.equal(selectCampaignInspectorNodeId(nodes, ['code', 'event']), 'event')
  assert.equal(selectCampaignInspectorNodeId([nodes[0]!], ['group']), null)
  assert.equal(selectCampaignInspectorNodeId([], ['event']), null)
})

test('node clicks open, switch, and close the inspector', () => {
  assert.equal(getCampaignInspectorNodeIdAfterClick(null, 'event'), 'event')
  assert.equal(getCampaignInspectorNodeIdAfterClick('event', 'code'), 'code')
  assert.equal(getCampaignInspectorNodeIdAfterClick('event', 'event'), null)
})

test('pointer selection waits for a completed click before opening', () => {
  const nodes = [{ id: 'event', type: 'event' }] as never[]

  assert.equal(
    getCampaignInspectorNodeIdAfterSelection(null, nodes, ['event'], true),
    null,
  )
  assert.equal(
    getCampaignInspectorNodeIdAfterSelection('code', nodes, ['event'], true),
    'code',
  )
  assert.equal(
    getCampaignInspectorNodeIdAfterSelection(null, nodes, ['event'], false),
    'event',
  )
})

test('inspector width clamps to preferred, absolute, and workspace limits', () => {
  assert.equal(clampCampaignInspectorWidth(100, 1200), 320)
  assert.equal(clampCampaignInspectorWidth(900, 2000), 720)
  assert.equal(clampCampaignInspectorWidth(500, 700), 350)
  assert.equal(clampCampaignInspectorWidth(320, 500), 250)
})

test('keyboard resizing uses 16 pixel increments and clamps', () => {
  assert.equal(
    resizeCampaignInspectorWithKeyboard(420, 'ArrowLeft', 1200),
    420 + CAMPAIGN_INSPECTOR_RESIZE_STEP,
  )
  assert.equal(
    resizeCampaignInspectorWithKeyboard(420, 'ArrowRight', 1200),
    420 - CAMPAIGN_INSPECTOR_RESIZE_STEP,
  )
  assert.equal(resizeCampaignInspectorWithKeyboard(400, 'Home', 1200), 320)
  assert.equal(resizeCampaignInspectorWithKeyboard(400, 'End', 1200), 600)
})

test('Nodes List toolbar toggles overview and replaces an inspector', () => {
  assert.deepEqual(toggleCampaignAllNodesPanel({ mode: 'closed' }), {
    mode: 'overview',
  })
  assert.deepEqual(toggleCampaignAllNodesPanel({ mode: 'overview' }), {
    mode: 'closed',
  })
  assert.deepEqual(
    toggleCampaignAllNodesPanel({
      mode: 'inspector',
      nodeId: 'node-1',
      taskGroupId: 'group-1',
      source: 'canvas',
    }),
    { mode: 'overview' },
  )
})

test('Nodes List navigation from any inspector restores its node row', () => {
  for (const source of ['canvas', 'overview'] as const) {
    assert.deepEqual(
      openCampaignNodesList({
        mode: 'inspector',
        nodeId: 'node-1',
        taskGroupId: 'group-1',
        source,
      }),
      { mode: 'overview', restoreFocusNodeId: 'node-1' },
    )
  }
})

test('leaving an overview inspector returns to its row', () => {
  const overviewInspector = {
    mode: 'inspector',
    nodeId: 'node-1',
    taskGroupId: 'group-1',
    source: 'overview',
  } as const
  assert.deepEqual(leaveCampaignInspector(overviewInspector), {
    mode: 'overview',
    restoreFocusNodeId: 'node-1',
  })
  assert.deepEqual(
    leaveCampaignInspector({ ...overviewInspector, source: 'canvas' }),
    { mode: 'closed' },
  )
})

test('clearing a canvas selection closes the inspector shell', () => {
  assert.deepEqual(
    reconcileCampaignPanelAfterSelectionClear({
      mode: 'inspector',
      nodeId: 'node-1',
      taskGroupId: 'group-1',
      source: 'canvas',
    }),
    { mode: 'closed' },
  )
})

test('clearing an overview selection returns to its row', () => {
  assert.deepEqual(
    reconcileCampaignPanelAfterSelectionClear({
      mode: 'inspector',
      nodeId: 'node-1',
      taskGroupId: 'group-1',
      source: 'overview',
    }),
    { mode: 'overview', restoreFocusNodeId: 'node-1' },
  )
})

test('clearing selection preserves an open Nodes List overview', () => {
  const overview = { mode: 'overview' } as const
  assert.equal(reconcileCampaignPanelAfterSelectionClear(overview), overview)
})

test('clearing selection leaves a closed panel unchanged', () => {
  const closed = { mode: 'closed' } as const
  assert.equal(reconcileCampaignPanelAfterSelectionClear(closed), closed)
})

test('manual sheet changes preserve overview navigation semantics', () => {
  const overviewInspector = {
    mode: 'inspector',
    nodeId: 'node-1',
    taskGroupId: 'group-1',
    source: 'overview',
  } as const
  assert.deepEqual(reconcileCampaignPanelAfterSheetChange(overviewInspector), {
    mode: 'overview',
    restoreFocusNodeId: 'node-1',
  })
  assert.deepEqual(
    reconcileCampaignPanelAfterSheetChange({
      ...overviewInspector,
      source: 'canvas',
    }),
    { mode: 'closed' },
  )
  assert.deepEqual(
    reconcileCampaignPanelAfterSheetChange({ mode: 'overview' }),
    { mode: 'overview' },
  )
})
