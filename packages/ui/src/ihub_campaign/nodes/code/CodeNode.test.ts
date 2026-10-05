/* eslint-disable @typescript-eslint/no-require-imports -- Node's direct TS test runner uses source inspection without changing package module settings. */
const { readFileSync }: typeof import('node:fs') = require('node:fs')
const { join }: typeof import('node:path') = require('node:path')
const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')

const codeNodeSource = readFileSync(join(__dirname, 'CodeNode.tsx'), 'utf8')

test('code nodes use shared actions for Run, Rename, and confirmed deletion', () => {
  assert.match(codeNodeSource, /id: 'run'/)
  assert.match(
    codeNodeSource,
    /onSelect: \(\) => void executeCell\(activeCell\.id\)/,
  )
  assert.match(codeNodeSource, /disabled: readOnly/)
  assert.match(codeNodeSource, /id: 'rename'/)
  assert.match(codeNodeSource, /onSelect: \(\) => alert\('TODO'\)/)
  assert.match(codeNodeSource, /actions=\{actions\}/)
  assert.match(codeNodeSource, /onDelete=\{onDelete\}/)
  assert.doesNotMatch(codeNodeSource, /CodeNodeMenu/)
})

test('historical code nodes guard editing and execution by provenance', () => {
  assert.match(codeNodeSource, /key=\{provenanceKey\}/)
  assert.match(codeNodeSource, /if \(canMutate\(provenanceKey\)\)/)
  assert.match(codeNodeSource, /if \(!canMutate\(provenanceKey\)\) return/)
  assert.match(codeNodeSource, /readOnly=\{readOnly\}/)
})
