import type { CampaignGraphData } from '@ihub/utils/types/campaign'

// Node's focused TypeScript runner requires the imported file extension.
// @ts-expect-error TypeScript extensions are valid because this package is no-emit.
import { campaignReducer, type CampaignAction } from './campaignReducer.ts'

export type CampaignMutationOrigin = 'model' | 'editor'

export type CampaignStoreSnapshot = {
  state: CampaignGraphData
  origin: CampaignMutationOrigin
  revision: number
  modelRevision: number
  editorRevision: number
}

export type CampaignStore = {
  getSnapshot: () => CampaignStoreSnapshot
  subscribe: (listener: () => void) => () => void
  dispatch: (action: CampaignAction) => void
}

const defaultValue: CampaignGraphData = {
  campaignId: '',
  campaignName: '',
  nodes: [],
  edges: [],
  createdAt: '',
  updatedAt: '',
}

/** Creates the dependency-free store used by CampaignProvider. */
export function createCampaignStore(
  initialState: CampaignGraphData = defaultValue,
): CampaignStore {
  let snapshot: CampaignStoreSnapshot = {
    state: initialState,
    origin: 'model',
    revision: 0,
    modelRevision: 0,
    editorRevision: 0,
  }
  const listeners = new Set<() => void>()

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispatch: (action) => {
      const nextState = campaignReducer(snapshot.state, action)
      if (nextState === snapshot.state) return

      const origin: CampaignMutationOrigin =
        action.type === 'SET_CAMPAIGN' ? 'model' : 'editor'
      snapshot = {
        state: nextState,
        origin,
        revision: snapshot.revision + 1,
        modelRevision: snapshot.modelRevision + (origin === 'model' ? 1 : 0),
        editorRevision: snapshot.editorRevision + (origin === 'editor' ? 1 : 0),
      }
      listeners.forEach((listener) => listener())
    },
  }
}
