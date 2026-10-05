import { useMemo } from 'react'
import { Spec } from 'vega'
import { VegaVisualizationData } from '@ihub/utils/types/visualization'
import { VegaVisualization } from './VegaVisualization'
import { vegaDefaultOptions } from './VegaDefaultOptions'

export type HistogramSpecConfig = {
  data: Record<string, unknown>[]
  field: string
  title?: string
  width?: number
  height?: number
  binStep?: number
  extent?: [number, number]
  color?: string
}

function getNumericExtent(
  data: Record<string, unknown>[],
  field: string,
  fallback: [number, number],
): [number, number] {
  const values = data
    .map((row) => row[field])
    .filter(
      (value): value is number =>
        typeof value === 'number' && Number.isFinite(value),
    )

  if (values.length === 0) {
    return fallback
  }

  let min = Math.min(...values)
  let max = Math.max(...values)

  if (min === max) {
    min -= 1
    max += 1
  }

  return [min, max]
}

export function buildHistogramSpec(config: HistogramSpecConfig): Spec {
  const {
    data,
    field,
    title = 'Histogram',
    width = 400,
    height = 250,
    binStep = 1,
    extent,
    color = 'steelblue',
  } = config

  const computedExtent = extent ?? getNumericExtent(data, field, [0, 1])

  return {
    $schema: 'https://vega.github.io/schema/vega/v6.json',
    description: title,
    width,
    height,
    autosize: 'fit',
    padding: 25,
    signals: [
      { name: 'binOffset', value: 0 },
      { name: 'binStep', value: binStep },
    ],
    data: [
      {
        name: 'points',
        values: data,
        transform: [
          {
            type: 'filter',
            expr: `isValid(datum[${JSON.stringify(field)}])`,
          },
        ],
      },
      {
        name: 'binned',
        source: 'points',
        transform: [
          {
            type: 'bin',
            field,
            extent: computedExtent,
            anchor: { signal: 'binOffset' },
            step: { signal: 'binStep' },
            nice: true,
          },
          {
            type: 'aggregate',
            key: 'bin0',
            groupby: ['bin0', 'bin1'],
            fields: ['bin0'],
            ops: ['count'],
            as: ['count'],
          },
        ],
      },
    ],
    scales: [
      {
        name: 'xscale',
        type: 'linear',
        range: 'width',
        domain: computedExtent,
      },
      {
        name: 'yscale',
        type: 'linear',
        range: 'height',
        round: true,
        domain: { data: 'binned', field: 'count' },
        zero: true,
        nice: true,
      },
    ],
    axes: [
      { orient: 'bottom', scale: 'xscale', zindex: 1 },
      { orient: 'left', scale: 'yscale', tickCount: 5, zindex: 1 },
    ],
    marks: [
      {
        type: 'rect',
        from: { data: 'binned' },
        encode: {
          update: {
            x: { scale: 'xscale', field: 'bin0' },
            x2: {
              scale: 'xscale',
              field: 'bin1',
              offset: { signal: 'binStep > 0.02 ? -0.5 : 0' },
            },
            y: { scale: 'yscale', field: 'count' },
            y2: { scale: 'yscale', value: 0 },
            fill: { value: color },
          },
          hover: { fill: { value: 'firebrick' } },
        },
      },
    ],
  }
}

type VegaHistogramProps = Partial<HistogramSpecConfig> & {
  options?: Record<string, unknown>
  visData?: VegaVisualizationData
}

export function VegaHistogram({
  options = vegaDefaultOptions,
  visData,
  ...config
}: VegaHistogramProps) {
  const spec = useMemo(() => {
    if (visData?.spec) {
      return visData.spec
    }

    return buildHistogramSpec({
      data: config.data ?? [],
      field: config.field ?? 'value',
      title: config.title,
      width: config.width,
      height: config.height,
      binStep: config.binStep,
      extent: config.extent,
      color: config.color,
    })
  }, [
    visData?.spec,
    config.data,
    config.field,
    config.title,
    config.width,
    config.height,
    config.binStep,
    config.extent,
    config.color,
  ])

  const resolvedType = visData?.type ?? 'vega-histogram'

  return (
    <VegaVisualization
      visData={{
        type: resolvedType,
        spec,
      }}
      options={options}
    />
  )
}
