/* eslint-disable @typescript-eslint/no-require-imports -- Node's focused runner loads sibling TypeScript modules directly. */
const { readFileSync }: typeof import('node:fs') = require('node:fs')
const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')

import type {
  CampaignGraphData,
  CampaignNode,
} from '@ihub/utils/types/campaign'

const { createCampaignStore } =
  require('./campaignStore.ts') as typeof import('./campaignStore')

function graphState(): CampaignGraphData {
  return {
    campaignId: 'campaign-1',
    campaignName: 'Campaign',
    nodes: [
      {
        id: 'node-1',
        type: 'capability',
        position: { x: 0, y: 0 },
        data: { manualInputValues: { value: 1 } },
      } as unknown as CampaignNode,
      {
        id: 'node-2',
        type: 'capability',
        position: { x: 1, y: 1 },
        data: { manualInputValues: { value: 2 } },
      } as unknown as CampaignNode,
    ],
    edges: [],
    createdAt: '',
    updatedAt: '',
  }
}

test('campaign store records model and editor revisions independently', () => {
  const initial = graphState()
  const store = createCampaignStore(initial)
  let notifications = 0
  store.subscribe(() => {
    notifications += 1
  })

  store.dispatch({
    type: 'SET_CAMPAIGN',
    payload: { graphData: { ...initial, campaignName: 'Hydrated' } },
  })
  assert.deepEqual(store.getSnapshot(), {
    state: { ...initial, campaignName: 'Hydrated' },
    origin: 'model',
    revision: 1,
    modelRevision: 1,
    editorRevision: 0,
  })

  store.dispatch({
    type: 'UPDATE_NODE_DATA',
    payload: {
      nodeId: 'node-1',
      updatedNodeData: {
        manualInputValues: { value: 3 },
      } as unknown as CampaignNode['data'],
    },
  })
  assert.equal(store.getSnapshot().origin, 'editor')
  assert.equal(store.getSnapshot().revision, 2)
  assert.equal(store.getSnapshot().modelRevision, 1)
  assert.equal(store.getSnapshot().editorRevision, 1)
  assert.equal(notifications, 2)
})

test('unrelated node references and no-op revisions remain stable', () => {
  const store = createCampaignStore(graphState())
  const unrelatedNode = store.getSnapshot().state.nodes[1]
  const before = store.getSnapshot()

  store.dispatch({ type: 'DELETE_NODE', payload: { nodeId: 'missing' } })
  assert.strictEqual(store.getSnapshot(), before)

  store.dispatch({
    type: 'UPDATE_NODE_DATA',
    payload: {
      nodeId: 'node-1',
      updatedNodeData: {
        manualInputValues: { value: 4 },
      } as unknown as CampaignNode['data'],
    },
  })
  assert.strictEqual(store.getSnapshot().state.nodes[1], unrelatedNode)
})

test('dispatch-only actions do not subscribe and graph sync has no stringify diff', () => {
  const contextSource = readFileSync(
    require.resolve('./campaignContext.tsx'),
    'utf8',
  )
  const editorSource = readFileSync(
    require.resolve('../editor/useCampaignGraphEditor.ts'),
    'utf8',
  )

  const actionsFunction = contextSource.match(
    /export const useCampaignActions[\s\S]*?\n\}/,
  )
  assert.ok(actionsFunction)
  assert.match(actionsFunction[0], /useCampaignStore\(\)/)
  assert.doesNotMatch(actionsFunction[0], /useCampaignStoreSelector/)
  assert.doesNotMatch(editorSource, /JSON\.stringify/)
  assert.match(editorSource, /snapshot\.editorRevision/)
})
