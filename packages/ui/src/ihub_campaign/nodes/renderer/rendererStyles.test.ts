/* eslint-disable @typescript-eslint/no-require-imports -- Campaign tests run through Node's direct TypeScript support. */
const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')
const { readFileSync }: typeof import('node:fs') = require('node:fs')
const { join }: typeof import('node:path') = require('node:path')

const {
  emptyRendererPreviewStyle,
  textPreviewStyle,
}: typeof import('./rendererStyles') = require('./rendererStyles.ts')
const rendererNodeSource = readFileSync(
  join(__dirname, 'RendererNode.tsx'),
  'utf8',
)

test('renderer previews use Mantine semantic colors in every text layout', () => {
  const previews = [
    textPreviewStyle('{"status":"ready"}'),
    textPreviewStyle('Ready'),
    textPreviewStyle('A longer value\nthat uses the multiline layout'),
  ]

  for (const preview of previews) {
    assert.equal(preview.color, 'var(--mantine-color-text)')
  }

  assert.equal(
    emptyRendererPreviewStyle.background,
    'var(--mantine-color-body)',
  )
  assert.equal(emptyRendererPreviewStyle.color, 'var(--mantine-color-dimmed)')
})

test('renderer previews label the iteration that produced their output', () => {
  assert.match(
    rendererNodeSource,
    /\(Output from Iteration \{outputIteration\}\)/,
  )
  assert.match(rendererNodeSource, /outputIteration !== null/)
})
