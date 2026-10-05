export interface NodeStyle {
  background: string
  border: string
  hoverBackground?: string
  iconBackground?: string
  width?: number
  height?: number
}

export const nodeStyleMap: Record<string, NodeStyle> = {
  intersect: {
    background: 'var(--mantine-color-body)',
    border: '2px solid var(--mantine-color-blue-6)',
    hoverBackground: 'var(--mantine-color-blue-5)',
    iconBackground: 'var(--mantine-color-blue-6)',
    width: 400,
    height: 380,
  },
  code: {
    background: 'var(--mantine-color-body)',
    border: '2px solid var(--mantine-color-orange-6)',
    hoverBackground: 'var(--mantine-color-orange-5)',
    iconBackground: 'var(--mantine-color-orange-6)',
    width: 400,
    height: 380,
  },
  visualization: {
    background: 'var(--mantine-color-body)',
    border: '2px solid var(--mantine-color-violet-6)',
    hoverBackground: 'var(--mantine-color-violet-5)',
    iconBackground: 'var(--mantine-color-violet-6)',
    width: 400,
    height: 380,
  },
  json: {
    background: 'var(--mantine-color-body)',
    border: '2px solid var(--mantine-color-cyan-6)',
    hoverBackground: 'var(--mantine-color-cyan-5)',
    iconBackground: 'var(--mantine-color-cyan-6)',
    width: 400,
    height: 380,
  },
  default: {
    background: 'var(--mantine-color-body)',
    border: '2px solid var(--mantine-color-gray-6)',
    hoverBackground: 'var(--mantine-color-gray-5)',
    iconBackground: 'var(--mantine-color-gray-6)',
    width: 400,
    height: 380,
  },
}

export const defaultNodeStyle = {
  background: 'var(--mantine-color-body)',
  border: '2px solid var(--mantine-color-gray-6)',
  hoverBackground: 'var(--mantine-color-gray-5)',
  iconBackground: 'var(--mantine-color-gray-6)',
  width: 400,
  height: 350,
}
