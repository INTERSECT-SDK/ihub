export const defaultPlotlyLayout: Partial<Plotly.Layout> = {
  autosize: true,
  height: 206,
  margin: { t: 50, b: 30, l: 50, r: 10 },
  paper_bgcolor: 'transparent',
  plot_bgcolor: 'transparent',
  modebar: {
    bgcolor: 'rgba(0,0,0,0.2)',
    color: 'rgba(255,255,255,0.8)',
    activecolor: 'rgba(255,255,255,1)',
  },
}

export type PlotlyVisualizationRegistryEntry = {
  name: string
  type: string
  icon: unknown
  plotlyData: Partial<Plotly.Data>[]
  plotlyLayout: Partial<Plotly.Layout>
  inputs?: VisualizationConfigInput[]
}

export type VisualizationConfigInput = {
  key: string
  label: string
  description?: string
}

export const PlotlyVisualizationRegistry: PlotlyVisualizationRegistryEntry[] = [
  {
    name: 'Line Chart',
    type: 'plotly-line',
    icon: null,
    plotlyData: [
      {
        type: 'scatter',
        mode: 'lines',
        marker: { color: 'purple' },
        x: [],
        y: [],
      },
    ],
    plotlyLayout: defaultPlotlyLayout,
    inputs: [
      {
        key: 'x',
        label: 'X Field (optional)',
        description:
          'Field for the x-axis. Leave empty to use row index as time series.',
      },
      {
        key: 'y',
        label: 'Y Field',
        description: 'Field for the y-axis',
      },
    ],
  },
  {
    name: 'Scatter Plot',
    type: 'plotly-scatter',
    icon: null,
    plotlyData: [
      {
        type: 'scatter',
        mode: 'markers',
        marker: { color: 'purple' },
        x: [],
        y: [],
      },
    ],
    plotlyLayout: defaultPlotlyLayout,
    inputs: [
      {
        key: 'x',
        label: 'X Field',
        description: 'Field for the x-axis',
      },
      {
        key: 'y',
        label: 'Y Field',
        description: 'Field for the y-axis',
      },
    ],
  },
  {
    name: 'Histogram',
    type: 'plotly-histogram',
    icon: null,
    plotlyData: [
      {
        type: 'histogram',
        marker: { color: 'purple' },
        x: [],
      },
    ],
    plotlyLayout: defaultPlotlyLayout,
    inputs: [
      {
        key: 'x',
        label: 'X',
        description: 'Numeric field to bin',
      },
    ],
  },
]

export const PlotlyVisualizationRegistryByType =
  PlotlyVisualizationRegistry.reduce(
    (registry, entry) => {
      registry[entry.type] = entry
      return registry
    },
    {} as Record<string, PlotlyVisualizationRegistryEntry>,
  )

/** Creates isolated Plotly data and layout defaults for a registered type. */
export function createPlotlyVisualizationDefaults(type: string):
  | {
      plotlyData: Partial<Plotly.Data>[]
      plotlyLayout: Partial<Plotly.Layout>
    }
  | undefined {
  const entry = PlotlyVisualizationRegistryByType[type]
  if (!entry) return undefined

  return {
    plotlyData: structuredClone(entry.plotlyData),
    plotlyLayout: structuredClone(entry.plotlyLayout),
  }
}
