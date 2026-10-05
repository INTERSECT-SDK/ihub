export interface NodeStyle {
  background: string
  border: string
  hoverBackground?: string
}

export const nodeStyleMap: Record<string, NodeStyle> = {
  IntersectS3M: {
    background: '#ecf5ff',
    border: '2px solid #3b82f6',
    hoverBackground: '#c8e0ff',
  },
  Capability2: { background: '#ecf5ff', border: '2px solid #3b82f6' },
  Capability3: { background: '#ecf5ff', border: '2px solid #3b82f6' },
  JupyterCode: {
    background: '#f2edff',
    border: '2px solid #8e24aa',
    hoverBackground: '#d9c2ff',
  },
}
