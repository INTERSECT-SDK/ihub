/* eslint-disable @typescript-eslint/no-require-imports -- Node's direct TS test runner needs require() for the sibling .ts module without changing package module settings. */
const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')

const { campaignReducer } =
  require('./campaignReducer.ts') as typeof import('./campaignReducer')

type CampaignGraphData = import('@ihub/utils/types/campaign').CampaignGraphData
type CampaignEdge = import('@ihub/utils/types/campaign').CampaignEdge
type CampaignNode = import('@ihub/utils/types/campaign').CampaignNode
type CampaignNodeType = import('@ihub/utils/types/campaign').CampaignNodeType

function createNodeData(
  name: string,
  overrides: Partial<CampaignNode['data']> = {},
): CampaignNode['data'] {
  return {
    capability: {
      id: name,
      name,
      created_at: '2026-06-20T00:00:00.000Z',
      last_lifecycle_message: '',
      service_id: 1,
      endpoints_schema: {
        endpoints: {},
        description: '',
      },
    },
    endpoint: 'run',
    endpoint_channel: {
      publish: {
        message: {
          schemaFormat: 'application/schema+json',
          contentType: 'application/json',
          traits: { $ref: '#/components/messages/result' },
          payload: {
            type: 'object',
            title: 'Output',
          },
        },
        description: '',
      },
      subscribe: {
        message: {
          schemaFormat: 'application/schema+json',
          contentType: 'application/json',
          traits: { $ref: '#/components/messages/request' },
          payload: {
            type: 'object',
            title: 'Input',
          },
        },
        description: '',
      },
      events: [],
    },
    ...overrides,
  } as CampaignNode['data']
}

function createNode(
  id: string,
  data: CampaignNode['data'] = createNodeData(id),
  type: CampaignNodeType = 'capability',
): CampaignNode {
  return {
    id,
    type,
    data,
    position: { x: 0, y: 0 },
  }
}

function createEdge(id: string, source: string, target: string): CampaignEdge {
  return {
    id,
    source,
    target,
    sourceHandle: 'bottom',
    targetHandle: 'top',
    type: 'baseCampaignEdge',
    data: {
      data_mapping: [
        {
          source_parameter: 'result.value',
          target_parameter: 'payload.value',
        },
      ],
      isFeedback: true,
      isOrthogonal: false,
      horizontalDirection: 'right',
    },
  }
}

function createCampaignState(): CampaignGraphData {
  return {
    campaignId: 'campaign-1',
    campaignName: 'Campaign',
    nodes: [createNode('source'), createNode('middle'), createNode('target')],
    edges: [
      createEdge('edge-source-middle', 'source', 'middle'),
      createEdge('edge-middle-target', 'middle', 'target'),
      createEdge('edge-source-target', 'source', 'target'),
    ],
    createdAt: '2026-06-20T00:00:00.000Z',
    updatedAt: '2026-06-20T00:00:00.000Z',
  }
}

const campaignNodeTypes: CampaignNodeType[] = [
  'capability',
  'event',
  'code',
  'visualization',
  'image-renderer',
  'text-renderer',
  'json-file',
  'json-text',
]

for (const nodeType of campaignNodeTypes) {
  test(`campaignReducer deletes ${nodeType} nodes and connected edges`, () => {
    const state = createCampaignState()
    state.nodes[1] = createNode('middle', createNodeData('middle'), nodeType)

    const result = campaignReducer(state, {
      type: 'DELETE_NODE',
      payload: { nodeId: 'middle' },
    })

    assert.deepEqual(
      result.nodes.map((node) => node.id),
      ['source', 'target'],
    )
    assert.deepEqual(
      result.edges.map((edge) => edge.id),
      ['edge-source-target'],
    )
  })
}

test('campaignReducer updates only the target node data', () => {
  const state = createCampaignState()
  const updatedNodeData = createNodeData('middle-updated', {
    manualInputValues: {
      sample: 42,
    },
  })

  const result = campaignReducer(state, {
    type: 'UPDATE_NODE_DATA',
    payload: { nodeId: 'middle', updatedNodeData },
  })

  assert.strictEqual(result.nodes[0], state.nodes[0])
  assert.strictEqual(result.nodes[2], state.nodes[2])
  assert.deepEqual(result.nodes[1]?.data, updatedNodeData)
})

test('campaignReducer updates target edge data without changing route fields', () => {
  const state = createCampaignState()
  const originalEdge = state.edges[0]!
  const updatedEdgeData: CampaignEdge['data'] = {
    ...originalEdge.data,
    data_mapping: [
      {
        source_parameter: 'result.other',
        target_parameter: 'payload.other',
      },
    ],
  }

  const result = campaignReducer(state, {
    type: 'UPDATE_EDGE_DATA',
    payload: { edgeId: originalEdge.id, updatedEdgeData },
  })
  const updatedEdge = result.edges[0]

  assert.equal(updatedEdge?.source, originalEdge.source)
  assert.equal(updatedEdge?.target, originalEdge.target)
  assert.equal(updatedEdge?.sourceHandle, originalEdge.sourceHandle)
  assert.equal(updatedEdge?.targetHandle, originalEdge.targetHandle)
  assert.deepEqual(updatedEdge?.data, updatedEdgeData)
  assert.strictEqual(result.edges[1], state.edges[1])
  assert.strictEqual(result.edges[2], state.edges[2])
})

test('campaignReducer clears node output data', () => {
  const state = {
    ...createCampaignState(),
    nodes: [
      createNode('source', createNodeData('source')),
      createNode(
        'middle',
        createNodeData('middle', {
          outputs: [
            {
              title: 'Result',
              type: 'number',
              value: 10,
            },
          ],
        }),
      ),
    ],
  }

  const result = campaignReducer(state, {
    type: 'CLEAR_NODE_OUTPUT',
    payload: { nodeId: 'middle' },
  })

  assert.deepEqual(result.nodes[1]?.data.outputs, [])
  assert.strictEqual(result.nodes[0], state.nodes[0])
})

test('campaignReducer treats missing node and edge ids as no-ops', () => {
  const state = createCampaignState()

  assert.strictEqual(
    campaignReducer(state, {
      type: 'DELETE_NODE',
      payload: { nodeId: 'missing-node' },
    }),
    state,
  )
  assert.strictEqual(
    campaignReducer(state, {
      type: 'UPDATE_NODE_DATA',
      payload: {
        nodeId: 'missing-node',
        updatedNodeData: createNodeData('missing'),
      },
    }),
    state,
  )
  assert.strictEqual(
    campaignReducer(state, {
      type: 'CLEAR_NODE_OUTPUT',
      payload: { nodeId: 'missing-node' },
    }),
    state,
  )
  assert.strictEqual(
    campaignReducer(state, {
      type: 'DELETE_EDGE',
      payload: { edgeId: 'missing-edge' },
    }),
    state,
  )
  assert.strictEqual(
    campaignReducer(state, {
      type: 'UPDATE_EDGE_DATA',
      payload: {
        edgeId: 'missing-edge',
        updatedEdgeData: {
          data_mapping: [],
        },
      },
    }),
    state,
  )
})
