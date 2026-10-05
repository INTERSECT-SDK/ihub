/* eslint-disable @typescript-eslint/no-require-imports -- Node directly executes focused TypeScript tests in this package. */
const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')

const { buildPlotlyPreviewLayout } =
  require('./plotlyPreviewLayout.ts') as typeof import('./plotlyPreviewLayout')

test('preview dimensions override saved sizing and preserve chart settings', () => {
  const layout = Object.freeze({
    width: 800,
    height: 600,
    autosize: true,
    title: { text: 'Results' },
    xaxis: { title: { text: 'Time' } },
    yaxis: { range: [0, 10] },
    legend: { orientation: 'h' },
    margin: { l: 40, r: 20, t: 50, b: 40 },
  })
  const original = structuredClone(layout)

  const preview = buildPlotlyPreviewLayout(layout, 420, 180)

  assert.deepEqual(preview, {
    ...original,
    width: 420,
    height: 180,
    autosize: false,
  })
  assert.notEqual(preview, layout)
  assert.deepEqual(layout, original)
})

test('preview follows new container dimensions without changing saved sizing', () => {
  const layout = { width: 800, height: 600, autosize: false }
  const first = buildPlotlyPreviewLayout(layout, 420, 180)
  const resized = buildPlotlyPreviewLayout(layout, 500, 240)

  assert.deepEqual(resized, {
    width: 500,
    height: 240,
    autosize: false,
    margin: { l: 40, r: 20, t: 40, b: 40 },
  })
  assert.deepEqual(first, {
    width: 420,
    height: 180,
    autosize: false,
    margin: { l: 40, r: 20, t: 40, b: 40 },
  })
  assert.deepEqual(layout, { width: 800, height: 600, autosize: false })
})

test('preview supplies explicit dimensions when saved sizing is absent', () => {
  assert.deepEqual(buildPlotlyPreviewLayout({}, 420, 180), {
    width: 420,
    height: 180,
    autosize: false,
    margin: { l: 40, r: 20, t: 40, b: 40 },
  })
})

test('partial saved margins retain explicit spacing and fill missing sides', () => {
  const layout = { margin: Object.freeze({ t: 60, pad: 4 }) }
  const preview = buildPlotlyPreviewLayout(layout, 384, 230)

  assert.deepEqual(preview.margin, { l: 40, r: 20, t: 60, b: 40, pad: 4 })
  assert.deepEqual(layout.margin, { t: 60, pad: 4 })
})
