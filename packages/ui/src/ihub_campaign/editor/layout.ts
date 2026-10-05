import ELK from 'elkjs/lib/elk.bundled.js'
import type { CampaignEdge, CampaignNode } from '@ihub/utils/types/campaign'

const elk = new ELK()

function parseNodeDimension(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value
  }

  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed
    }
  }

  return undefined
}

/** Campaign graph layout behavior exposed by the editor toolbar. */
export type LayoutMode = 'force' | 'straighten'

/** Computes an ELK layout while preserving the existing campaign edge set. */
export async function layoutGraph(
  nodes: CampaignNode[],
  edges: CampaignEdge[],
  direction: 'RIGHT',
  mode: LayoutMode = 'force',
): Promise<{ nodes: CampaignNode[]; edges: CampaignEdge[] }> {
  const elkGraph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': mode === 'straighten' ? 'force' : 'force',
      'elk.force.iterations': mode === 'straighten' ? '0' : '150',
      'elk.force.idealEdgeLength': '150',
      'elk.force.idealEdgeLengthFactor': '1',
      'elk.force.cycleBreaking.strategy': 'MAXIMUM_SUM',
      'elk.force.nodeSpacing': '100',
      'elk.spacing.edgeNode': '80',
      'elk.edgeRouting': 'POLYLINE',
    },
    children: nodes.map((node) => ({
      id: node.id,
      width:
        node.measured?.width ??
        node.width ??
        parseNodeDimension(
          (node.style as Record<string, unknown> | undefined)?.width,
        ) ??
        400,
      height:
        node.measured?.height ??
        node.height ??
        parseNodeDimension(
          (node.style as Record<string, unknown> | undefined)?.height,
        ) ??
        380,
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    })),
  }

  const layoutedGraph = await elk.layout(elkGraph)
  const layoutedNodes = nodes.map((node) => {
    const elkNode = layoutedGraph.children?.find(
      (child) => child.id === node.id,
    )
    return {
      ...node,
      position: {
        x: elkNode?.x ?? node.position.x ?? 0,
        y: elkNode?.y ?? node.position.y ?? 0,
      },
    }
  })

  return { nodes: layoutedNodes, edges }
}
