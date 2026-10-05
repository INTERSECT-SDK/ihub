/* eslint-disable @typescript-eslint/no-require-imports -- Node directly executes focused TypeScript tests in this package. */
const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')
const {
  buildVisualizationPlotData,
  getDisplayedVisualizationMappings,
  normalizeVisualizationMappings,
  visualizationMappingsAreEqual,
} =
  require('./VisualizationMapping.ts') as typeof import('./VisualizationMapping')

test('visualization mapping builds a trace and preserves fallback configuration', () => {
  assert.deepEqual(
    buildVisualizationPlotData(
      {
        x: { sourceNodeId: 'code-1', sourcePath: 'values' },
        y: { sourceNodeId: 'code-1', sourcePath: 'nested:::counts' },
      },
      { x: [1, 2], counts: [3, 4] },
      [{ type: 'scatter', mode: 'lines' }],
    ),
    [
      {
        type: 'scatter',
        mode: 'lines',
        x: [1, 2],
        y: [3, 4],
      },
    ],
  )
})

test('visualization mapping keeps fallback data when nothing resolves', () => {
  const fallback = [{ x: [0], y: [0] }]
  assert.equal(
    buildVisualizationPlotData(
      { x: { sourceNodeId: 'code-1', sourcePath: 'missing' } },
      {},
      fallback,
    ),
    fallback,
  )
})

test('visualization and renderer mappings normalize and compare semantically', () => {
  const serialized = { x: 'code-1:::values', y: null }
  const normalized = {
    x: { sourceNodeId: 'code-1', sourcePath: 'values' },
    y: null,
  }

  assert.deepEqual(normalizeVisualizationMappings(serialized), normalized)
  assert.equal(visualizationMappingsAreEqual(serialized, normalized), true)
  assert.equal(
    visualizationMappingsAreEqual(normalized, {
      x: { sourceNodeId: 'code-2', sourcePath: 'values' },
      y: null,
    }),
    false,
  )
})

test('identical node IDs display mappings owned by the selected provenance', () => {
  const currentMappings = {
    x: { sourceNodeId: 'current-code', sourcePath: 'current-values' },
  }
  const historicalMappings = {
    x: { sourceNodeId: 'historical-code', sourcePath: 'run-values' },
  }

  assert.equal(
    getDisplayedVisualizationMappings(
      historicalMappings,
      currentMappings,
      true,
    ),
    historicalMappings,
  )
  assert.equal(
    getDisplayedVisualizationMappings(
      historicalMappings,
      currentMappings,
      false,
    ),
    currentMappings,
  )
  assert.equal(
    visualizationMappingsAreEqual(currentMappings, currentMappings),
    true,
    'unchanged editable mappings must not request a graph update',
  )
})
