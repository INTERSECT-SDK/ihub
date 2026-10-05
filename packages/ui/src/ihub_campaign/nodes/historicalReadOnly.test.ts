/* eslint-disable @typescript-eslint/no-require-imports -- Node's direct TS test runner uses source inspection without a browser DOM. */
const { readFileSync }: typeof import('node:fs') = require('node:fs')
const { join }: typeof import('node:path') = require('node:path')
const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')

function source(relativePath: string): string {
  return readFileSync(join(__dirname, relativePath), 'utf8')
}

test('historical event controls are disabled and guarded', () => {
  const eventNode = source('event/EventNode.tsx')
  assert.match(eventNode, /if \(!canMutate\(provenanceKey\)\) return/)
  assert.equal((eventNode.match(/disabled=\{readOnly\}/g) ?? []).length, 2)
  assert.match(eventNode, /value=\{activeTab\}\s+onChange=\{setActiveTab\}/)
})

test('historical JSON controls cannot edit, select, refresh, or persist', () => {
  const jsonTextNode = source('json-text/JsonTextNode.tsx')
  const jsonFileNode = source('json-file/JsonFileNode.tsx')

  assert.match(jsonTextNode, /disabled=\{readOnly\}/)
  assert.match(jsonTextNode, /if \(!canMutate\(provenanceKey\)\) return/)
  assert.match(jsonFileNode, /disabled=\{readOnly\}/)
  assert.match(jsonFileNode, /disabled=\{readOnly \|\| !data\.fileReference\}/)
  assert.match(
    jsonFileNode,
    /if \(!canMutate\(originatingProvenanceKey\)\) return/,
  )
})

test('mapping widgets are provenance-keyed and historical selects are disabled', () => {
  const visualizationNode = source('visualization/VisualizationNode.tsx')
  const rendererNode = source('renderer/RendererNode.tsx')
  const controlledMappings = source(
    'visualization/useControlledVisualizationMappings.ts',
  )
  const configuration = source('visualization/VisualizationConfiguration.tsx')

  assert.match(visualizationNode, /key=\{provenanceKey\}/)
  assert.match(rendererNode, /key=\{provenanceKey\}/)
  assert.match(visualizationNode, /useControlledVisualizationMappings\(id\)/)
  assert.match(rendererNode, /useControlledVisualizationMappings\(id\)/)
  assert.match(controlledMappings, /if \(readOnly\) return/)
  assert.doesNotMatch(visualizationNode, /useEffect/)
  assert.doesNotMatch(rendererNode, /useEffect/)
  assert.match(configuration, /disabled=\{readOnly \|\| !hasOptions\}/)
  assert.match(configuration, /if \(readOnly\) return/)
})

test('the shared notebook cell input keeps ordinary behavior and supports read-only code', () => {
  const cellInput = source('../../ihub_notebook/Cell.tsx')

  assert.match(cellInput, /readOnly\?: boolean/)
  assert.match(cellInput, /readOnly = false/)
  assert.match(cellInput, /options=\{\{\s*readOnly,/)
  assert.match(cellInput, /if \(editorDisposedRef\.current \|\| readOnly\)/)
  assert.match(cellInput, /if \(readOnly\) return/)
})
