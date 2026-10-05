/* eslint-disable @typescript-eslint/no-require-imports -- Node's direct TS runner loads dependency-free campaign helpers. */
const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')

const { createCampaignStore } =
  require('../../state/campaignStore.ts') as typeof import('../../state/campaignStore')
const { commitVisualizationMappingUpdate } =
  require('./visualizationMappingController.ts') as typeof import('./visualizationMappingController')

type CampaignGraphData = import('@ihub/utils/types/campaign').CampaignGraphData
type PlotlyVisualizationNode =
  import('@ihub/utils/types/campaign').PlotlyVisualizationNode

function createVisualizationStore() {
  const data: PlotlyVisualizationNode = {
    name: 'Chart',
    type: 'plotly-line',
    plotlyData: [],
    plotlyLayout: {},
    config: {
      input_mappings: {
        x: { sourceNodeId: 'source-a', sourcePath: '/x' },
      },
      preserved_option: true,
    } as PlotlyVisualizationNode['config'] & { preserved_option: boolean },
  }
  const graph = {
    campaignId: 'campaign',
    campaignName: 'Campaign',
    nodes: [
      {
        id: 'chart',
        type: 'visualization',
        data,
        position: { x: 0, y: 0 },
      },
    ],
    edges: [],
    createdAt: '',
    updatedAt: '',
  } as CampaignGraphData

  return createCampaignStore(graph)
}

function currentData(
  store: ReturnType<typeof createVisualizationStore>,
): PlotlyVisualizationNode {
  return store.getSnapshot().state.nodes[0]!.data as PlotlyVisualizationNode
}

test('mapping edits from either surface resolve against the latest node', () => {
  const store = createVisualizationStore()
  const mutable = () => true

  assert.equal(
    commitVisualizationMappingUpdate({
      store,
      nodeId: 'chart',
      provenanceKey: 'campaign:campaign',
      canMutate: mutable,
      update: (current) => ({
        ...current,
        y: { sourceNodeId: 'source-b', sourcePath: '/y' },
      }),
    }),
    true,
  )
  assert.equal(
    commitVisualizationMappingUpdate({
      store,
      nodeId: 'chart',
      provenanceKey: 'campaign:campaign',
      canMutate: mutable,
      update: (current) => ({
        ...current,
        x: { sourceNodeId: 'source-c', sourcePath: '/new-x' },
      }),
    }),
    true,
  )

  assert.deepEqual(currentData(store).config.input_mappings, {
    x: { sourceNodeId: 'source-c', sourcePath: '/new-x' },
    y: { sourceNodeId: 'source-b', sourcePath: '/y' },
  })
  assert.equal(
    (currentData(store).config as { preserved_option?: boolean })
      .preserved_option,
    true,
  )
})

test('mapping updates clear values and suppress normalized duplicates', () => {
  const store = createVisualizationStore()
  const beforeRevision = store.getSnapshot().revision

  assert.equal(
    commitVisualizationMappingUpdate({
      store,
      nodeId: 'chart',
      provenanceKey: 'campaign:campaign',
      canMutate: () => true,
      update: {
        x: 'source-a:::/x',
      },
    }),
    false,
  )
  assert.equal(store.getSnapshot().revision, beforeRevision)

  assert.equal(
    commitVisualizationMappingUpdate({
      store,
      nodeId: 'chart',
      provenanceKey: 'campaign:campaign',
      canMutate: () => true,
      update: {},
    }),
    true,
  )
  assert.deepEqual(currentData(store).config.input_mappings, {})
})

test('historical mapping edits remain display-only', () => {
  const store = createVisualizationStore()
  const snapshot = structuredClone(store.getSnapshot().state)

  assert.equal(
    commitVisualizationMappingUpdate({
      store,
      nodeId: 'chart',
      provenanceKey: 'run:historical',
      canMutate: () => false,
      update: {},
    }),
    false,
  )
  assert.deepEqual(store.getSnapshot().state, snapshot)
})
