/* eslint-disable @typescript-eslint/no-require-imports -- Source inspection avoids a browser-only renderer. */
const { readFileSync }: typeof import('node:fs') = require('node:fs')
const { join }: typeof import('node:path') = require('node:path')
const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')

const source = readFileSync(join(__dirname, 'JsonTextNode.tsx'), 'utf8')

test('JSON Text retains idle persistence and explicitly commits on blur', () => {
  assert.match(source, /JSON_TEXT_SAVE_DELAY_MS = 250/)
  assert.match(
    source,
    /window\.setTimeout\(commitTextValue, JSON_TEXT_SAVE_DELAY_MS\)/,
  )
  assert.match(source, /onBlur=\{commitTextValue\}/)
})
