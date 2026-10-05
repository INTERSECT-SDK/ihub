import { ComponentType } from 'react'
import { Spec } from 'vega'
import { createNewVegaVisualization } from '@ihub/utils/helpers/create'
import { VegaHistogram } from './VegaHistogram'

export type VisualizationRegistryEntry = {
  name: string
  type: string
  icon: any
  createSpec: () => Spec
  component?: ComponentType<any>
  inputs?: VisualizationConfigInput[]
}

export type VisualizationConfigInput = {
  key: string
  label: string
  description?: string
  kind?: 'dataset' | 'field' | 'value'
}

export const visualizationRegistry: VisualizationRegistryEntry[] = [
  {
    name: 'Line Chart',
    type: 'vega-line',
    icon: null,
    createSpec: () => createNewVegaVisualization('vega-line'),
    inputs: [
      {
        key: 'xField',
        label: 'X Field (optional)',
        description:
          'Field for the x-axis. Leave empty to use row index as time series.',
        kind: 'field',
      },
      {
        key: 'yField',
        label: 'Y Field',
        description: 'Field for the y-axis',
        kind: 'field',
      },
    ],
  },
  {
    name: 'Scatter Plot',
    type: 'vega-scatter',
    icon: null,
    createSpec: () => createNewVegaVisualization('vega-scatter'),
    inputs: [
      {
        key: 'xField',
        label: 'X Field',
        description: 'Field for the x-axis',
        kind: 'field',
      },
      {
        key: 'yField',
        label: 'Y Field',
        description: 'Field for the y-axis',
        kind: 'field',
      },
    ],
  },
  // {
  //   name: 'Bar Chart',
  //   type: 'vega-bar',
  //   icon: null,
  //   createSpec: () => createNewVegaVisualization('vega-bar'),
  // },
  // {
  //   name: 'Pie Chart',
  //   type: 'vega-pie',
  //   icon: null,
  //   createSpec: () => createNewVegaVisualization('vega-pie'),
  // },
  {
    name: 'Histogram',
    type: 'vega-histogram',
    icon: null,
    createSpec: () => createNewVegaVisualization('vega-histogram'),
    component: VegaHistogram,
    inputs: [
      {
        key: 'field',
        label: 'Field',
        description: 'Numeric field to bin',
        kind: 'field',
      },
    ],
  },
  // {
  //   name: 'Violin Plot',
  //   type: 'vega-violin',
  //   icon: null,
  //   createSpec: () => createNewVegaVisualization('vega-violin'),
  // },
  // {
  //   name: 'Custom Vega Chart',
  //   type: 'vega-custom',
  //   icon: null,
  //   createSpec: () => createNewVegaVisualization('vega-custom'),
  // },
]

export const visualizationRegistryByType = visualizationRegistry.reduce(
  (acc, entry) => {
    acc[entry.type] = entry
    return acc
  },
  {} as Record<string, VisualizationRegistryEntry>,
)
