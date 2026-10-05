import { Spec } from 'vega'

export type VisualizationFile = {
  type: 'visualization'
  format: 'json'
  content: VisualizationFileContent
  name: string
  [key: string]: any
}

export type VisualizationFileContent = {
  visualizations: VegaVisualizationData[]
}

export type VegaVisualizationData = {
  type?: string
  id?: string
  spec: Spec
}

export type VisualizationType = {
  name: string
  type: string
  icon: any
}
