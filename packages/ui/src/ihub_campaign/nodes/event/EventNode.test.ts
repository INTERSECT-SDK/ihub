/* eslint-disable @typescript-eslint/no-require-imports -- Source inspection verifies layout behavior without a browser DOM. */
const { readFileSync }: typeof import('node:fs') = require('node:fs')
const { join }: typeof import('node:path') = require('node:path')
const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')

const eventNodeSource = readFileSync(join(__dirname, 'EventNode.tsx'), 'utf8')

test('event logs fill the inspector while retaining the compact canvas height', () => {
  assert.match(
    eventNodeSource,
    /const viewportHeight = fillAvailableHeight \? '100%' : 220/,
  )
  assert.match(
    eventNodeSource,
    /fillAvailableHeight=\{renderSettings\.mode === 'inspector'\}/,
  )
  assert.match(
    eventNodeSource,
    /\? \{ flex: 1, minHeight: 0, overflow: 'hidden' \}/,
  )
})
