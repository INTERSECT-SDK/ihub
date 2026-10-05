/* eslint-disable @typescript-eslint/no-require-imports -- Node's direct TS test runner needs require() for source-inspection tests without changing package module settings. */
const { readFileSync }: typeof import('node:fs') = require('node:fs')
const { join }: typeof import('node:path') = require('node:path')
const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')

const baseNodeSource = readFileSync(join(__dirname, 'BaseNode.tsx'), 'utf8')
const baseNodeStyleSource = readFileSync(
  join(__dirname, 'style.module.css'),
  'utf8',
)

test('BaseNode isolates header actions from React Flow gestures', () => {
  const headerActionGroupMatch = baseNodeSource.match(
    /<Group\s+m=\{0\}\s+p=\{0\}[\s\S]*?>/,
  )

  assert.ok(headerActionGroupMatch, 'header action group should be present')

  const headerActionGroup = headerActionGroupMatch[0]

  assert.match(
    headerActionGroup,
    /className=\{`\$\{nodeStyles\.canvasHeaderActions\} nodrag nopan nowheel`\}/,
  )
  assert.match(headerActionGroup, /onPointerDown=\{stopReactFlowInteraction\}/)
  assert.match(headerActionGroup, /onMouseDown=\{stopReactFlowInteraction\}/)
  assert.match(headerActionGroup, /onTouchStart=\{stopReactFlowInteraction\}/)
})

test('BaseNode starts graph cards collapsed while preserving inspector content', () => {
  assert.match(
    baseNodeSource,
    /const \[showPanelState, setShowPanelState\] = useState\(false\)/,
  )
  assert.match(
    baseNodeSource,
    /const nodeHeight = showPanelState \? style\?\.height \|\| '380px' : '120px'/,
  )
  assert.match(baseNodeSource, /style\?\.height \|\| '380px'/)
  assert.match(baseNodeSource, /renderSettings\.mode === 'inspector'/)
  assert.match(baseNodeSource, /className=\{nodeStyles\.inspectorContent\}/)
  assert.match(baseNodeSource, /canExpand && showPanelState &&/)
  assert.match(baseNodeSource, />\s*\{children\}\s*<\/Card\.Section>/)
})

test('BaseNode reserves collapsed-card space for status badges', () => {
  assert.match(
    baseNodeSource,
    /const nodeHeight = showPanelState \? style\?\.height \|\| '380px' : '120px'/,
  )
  assert.match(baseNodeSource, /wrap='nowrap'/)
  assert.match(baseNodeSource, /className=\{nodeStyles\.canvasHeadingGroup\}/)
  assert.match(
    baseNodeSource,
    /className=\{`\$\{nodeStyles\.canvasHeaderActions\} nodrag nopan nowheel`\}/,
  )
  assert.match(
    baseNodeSource,
    /showPanelState \? undefined : nodeStyles\.collapsedSubtitle/,
  )
  assert.match(
    baseNodeSource,
    /!showPanelState && typeof subtitle === 'string'[\s\S]*?\? subtitle[\s\S]*?: undefined/,
  )
  assert.match(baseNodeSource, /className=\{nodeStyles\.nodeTags\}/)

  assert.match(
    baseNodeStyleSource,
    /\.canvasHeadingGroup \{[\s\S]*?flex: 1;[\s\S]*?min-width: 0;[\s\S]*?\}/,
  )
  assert.match(
    baseNodeStyleSource,
    /\.canvasHeaderActions \{[\s\S]*?flex-shrink: 0;[\s\S]*?\}/,
  )
  assert.match(
    baseNodeStyleSource,
    /\.collapsedSubtitle \{[\s\S]*?overflow: hidden;[\s\S]*?text-overflow: ellipsis;[\s\S]*?white-space: nowrap;[\s\S]*?\}/,
  )
  assert.match(
    baseNodeStyleSource,
    /\.nodeTags \{[\s\S]*?flex-shrink: 0;[\s\S]*?margin-top: auto;[\s\S]*?\}/,
  )
})

test('BaseNode leaves expanded and inspector subtitles unconstrained', () => {
  assert.match(
    baseNodeSource,
    /renderSettings\.mode === 'inspector'[\s\S]*?\{subtitle && <Text size='xs'>\{subtitle\}<\/Text>\}/,
  )
  assert.match(
    baseNodeSource,
    /showPanelState \? undefined : nodeStyles\.collapsedSubtitle/,
  )
  assert.match(
    baseNodeSource,
    /!showPanelState && typeof subtitle === 'string'[\s\S]*?: undefined/,
  )
})

test('overview inspectors expose Back while retaining the accessible close action', () => {
  assert.match(baseNodeSource, /renderSettings\.onBack &&/)
  assert.match(baseNodeSource, /onClick=\{renderSettings\.onBack\}/)
  assert.match(baseNodeSource, /backLabel \?\? 'Back to Nodes List'/)
  assert.match(baseNodeSource, /aria-label='Close node inspector'/)
})

test('BaseNode exposes an accessible eye toggle without changing task groups', () => {
  assert.match(
    baseNodeSource,
    /const canExpand = Boolean\(children\) && !onView/,
  )
  assert.match(baseNodeSource, /aria-expanded=\{showPanelState\}/)
  assert.match(baseNodeSource, /'Expand node details'/)
  assert.match(baseNodeSource, /'Collapse node details'/)
  assert.match(baseNodeSource, /<IHubIconShow size=\{16\} \/>/)
  assert.match(baseNodeSource, /<IHubIconHide size=\{16\} \/>/)
  assert.match(
    baseNodeSource,
    /onClick=\{\(\) => setShowPanelState\(\(visible\) => !visible\)\}/,
  )
  assert.match(baseNodeSource, /<Tooltip\s+label=\{/)
  assert.match(baseNodeSource, /events=\{tooltipEvents\}/)
})

test('BaseNode labels the task-group eye action with a tooltip', () => {
  assert.match(
    baseNodeSource,
    /<Tooltip label='Open canvas' events=\{tooltipEvents\}>/,
  )
  assert.match(baseNodeSource, /aria-label='Open canvas'/)
})

test('BaseNode refreshes React Flow internals after accordion changes', () => {
  assert.match(baseNodeSource, /useUpdateNodeInternals\(\)/)
  assert.match(
    baseNodeSource,
    /addEventListener\('transitionend', handleHeightTransitionEnd\)/,
  )
  assert.match(baseNodeSource, /event\.propertyName === 'height'/)
  assert.match(baseNodeSource, /event\.target === cardElement/)
  assert.match(baseNodeSource, /updateNodeInternals\(id\)/)
  assert.match(
    baseNodeSource,
    /\[canExpand, id, showPanelState, updateNodeInternals\]/,
  )
})

test('BaseNode isolates the chevron and expanded editor from graph gestures', () => {
  const isolatedInteractionCount = [
    /onClick=\{stopReactFlowInteraction\}/g,
    /onPointerDown=\{stopReactFlowInteraction\}/g,
    /onMouseDown=\{stopReactFlowInteraction\}/g,
    /onTouchStart=\{stopReactFlowInteraction\}/g,
    /onWheel=\{stopReactFlowInteraction\}/g,
  ]

  for (const eventPattern of isolatedInteractionCount) {
    assert.ok(
      (baseNodeSource.match(eventPattern) ?? []).length >= 2,
      `${eventPattern.source} should isolate the chevron and inline editor`,
    )
  }
})

test('BaseNode labels the node-actions trigger and delegates typed actions', () => {
  assert.match(baseNodeSource, /aria-label='Open node actions'/)
  assert.match(baseNodeSource, /<NodeActionsMenu actions=\{nodeActions\} \/>/)
})

test('BaseNode renders canvas actions independently of view and expand controls', () => {
  assert.match(
    baseNodeSource,
    /\{\(onView \|\| canExpand \|\| nodeActions \|\| dropdown\) && \(/,
  )
  assert.match(
    baseNodeSource,
    /\{onView \? \([\s\S]*?\) : canExpand \? \([\s\S]*?\) : null\}\s*\{nodeActions \? \(/,
  )
  assert.match(
    baseNodeSource,
    /<NodeActionsMenu actions=\{nodeActions\} \/>[\s\S]*?: dropdown \? \(/,
  )
})

test('BaseNode appends standardized node and task-group deletion actions', () => {
  assert.match(baseNodeSource, /onDelete\?: \(\) => void/)
  assert.match(baseNodeSource, /deleteTarget\?: 'node' \| 'task group'/)
  assert.match(baseNodeSource, /deleteTarget = 'node'/)
  assert.match(baseNodeSource, /\[\.\.\.\(actions \?\? \[\]\), deleteAction\]/)
  assert.match(baseNodeSource, /label: `Delete \$\{deleteTarget\}`/)
  assert.match(baseNodeSource, /prompt: `Delete \$\{deleteTarget\}\?`/)
  assert.match(
    baseNodeSource,
    /confirmLabel: `Confirm delete \$\{deleteTarget\}`/,
  )
  assert.match(
    baseNodeSource,
    /cancelLabel: `Cancel delete \$\{deleteTarget\}`/,
  )
})

test('BaseNode disables graph mutation actions in read-only campaign views', () => {
  assert.match(baseNodeSource, /const \{ readOnly \} = useCampaignView\(\)/)
  assert.match(baseNodeSource, /disabled: action\.disabled \|\| readOnly/)
  assert.match(baseNodeSource, /onClick=\{onView\}/)
})

const nodeActionsMenuSource = readFileSync(
  join(__dirname, 'NodeActionsMenu.tsx'),
  'utf8',
)

test('NodeActionsMenu keeps confirmation open and labels every control', () => {
  assert.match(nodeActionsMenuSource, /closeOnItemClick=\{false\}/)
  assert.match(nodeActionsMenuSource, /aria-label='Open node actions'/)
  assert.match(nodeActionsMenuSource, /aria-label=\{action\.label\}/)
  assert.match(nodeActionsMenuSource, /disabled=\{action\.disabled\}/)
  assert.match(nodeActionsMenuSource, /if \(!nextConfirmation\) \{/)
  assert.match(
    nodeActionsMenuSource,
    /aria-label=\{confirmation\.confirmLabel\}/,
  )
  assert.match(
    nodeActionsMenuSource,
    /disabled=\{confirmingAction\?\.disabled\}/,
  )
  assert.match(
    nodeActionsMenuSource,
    /aria-label=\{confirmation\.cancelLabel\}/,
  )
  assert.match(
    nodeActionsMenuSource,
    /events=\{tooltipEvents\}/,
    'tooltips should support keyboard focus',
  )
})
