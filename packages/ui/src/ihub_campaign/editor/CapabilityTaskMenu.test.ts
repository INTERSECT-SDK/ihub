/* eslint-disable @typescript-eslint/no-require-imports -- Node's direct TypeScript test runner needs require() for source-inspection tests without changing package module settings. */
const { readFileSync }: typeof import('node:fs') = require('node:fs')
const { join }: typeof import('node:path') = require('node:path')
const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')

const campaignPresentationSource = readFileSync(
  join(__dirname, 'CampaignPresentation.tsx'),
  'utf8',
)
const campaignStylesSource = readFileSync(
  join(__dirname, 'styles.module.css'),
  'utf8',
)

test('add-node dropdowns stay within the viewport and scroll vertically', () => {
  assert.match(
    campaignPresentationSource,
    /<Menu\.Dropdown[\s\S]*?className=\{classes\.addNodeMenuDropdown\}/,
  )
  assert.match(
    campaignStylesSource,
    /\.addNodeMenuScrollArea\s*\{[^}]*max-height:\s*min\(360px, calc\(100dvh - 80px\)\);[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto;/s,
  )
  assert.match(
    campaignStylesSource,
    /\.addNodeMenuDropdown\s*\{[^}]*width:\s*min\(400px, calc\(100vw - 24px\)\);[^}]*white-space:\s*nowrap;/s,
  )
})

test('add-node item labels stay on one line and slide when overflowing', () => {
  assert.match(
    campaignPresentationSource,
    /function SlidingMenuLabel[\s\S]*?content\.scrollWidth - container\.clientWidth/,
  )
  assert.match(
    campaignPresentationSource,
    /<Group justify='space-between' w='100%' wrap='nowrap'>/,
  )
  assert.match(
    campaignStylesSource,
    /\.slidingMenuLabel\s*\{[^}]*overflow:\s*hidden;[^}]*white-space:\s*nowrap;/s,
  )
  assert.match(
    campaignStylesSource,
    /@keyframes slideMenuLabel\s*\{[\s\S]*?translateX\(calc\(-1 \* var\(--menu-label-overflow\)\)\)/,
  )
})

test('a pointer press outside the add-node menu closes it', () => {
  assert.match(
    campaignPresentationSource,
    /document\.addEventListener\('pointerdown', closeOnOutsidePointerDown, true\)/,
  )
  assert.match(
    campaignPresentationSource,
    /event\.composedPath\(\)[\s\S]*?eventPath\.includes\(target\)[\s\S]*?eventPath\.includes\(dropdown\)/,
  )
  assert.match(campaignPresentationSource, /closeOnClickOutside/)
})

test('nested add-node menus stay inside their parent while escaping scroll clipping', () => {
  assert.match(
    campaignPresentationSource,
    /portalProps=\{\{ target: submenuPortalTarget \?\? undefined \}\}[\s\S]*?floatingStrategy='fixed'/,
  )
  assert.match(
    campaignPresentationSource,
    /target: capabilityPortalTarget \?\? undefined,[\s\S]*?floatingStrategy='fixed'/,
  )
  assert.equal(
    campaignPresentationSource.match(
      /<Menu\.Dropdown className=\{classes\.boundedMenuDropdown\}>/g,
    )?.length,
    2,
  )
})
