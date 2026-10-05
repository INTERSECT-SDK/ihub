/** Stable external campaign store and selector hooks for graph editor state. */
import type {
  CampaignGraphData,
  CampaignEdge,
  CampaignNode,
  CampaignNodeOutputData,
} from '@ihub/utils/types/campaign'
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react'

import {
  createCampaignStore,
  type CampaignStore,
  type CampaignStoreSnapshot,
} from './campaignStore'

export { campaignReducer } from './campaignReducer'
export type { CampaignAction } from './campaignReducer'
export { createCampaignStore } from './campaignStore'
export type {
  CampaignMutationOrigin,
  CampaignStore,
  CampaignStoreSnapshot,
} from './campaignStore'

export type CampaignActions = {
  setCampaign: (graphData: CampaignGraphData) => void
  addNode: (newNode: CampaignNode) => void
  deleteNode: (nodeId: string) => void
  addEdge: (newEdge: CampaignEdge) => void
  deleteEdge: (edgeId: string) => void
  updateNodeData: (
    nodeId: string,
    updatedNodeData: CampaignNode['data'],
  ) => void
  updateNodeOutput: (
    nodeId: string,
    updatedOutput: CampaignNodeOutputData,
  ) => void
  clearNodeOutput: (nodeId: string) => void
  updateEdgeData: (
    edgeId: string,
    updatedEdgeData: CampaignEdge['data'],
  ) => void
}

const CampaignContext = createContext<CampaignStore | null>(null)

export const CampaignProvider = ({ children }: { children: ReactNode }) => {
  const storeRef = useRef<CampaignStore | null>(null)
  storeRef.current ??= createCampaignStore()

  return (
    <CampaignContext.Provider value={storeRef.current}>
      {children}
    </CampaignContext.Provider>
  )
}

export function useCampaignStore(): CampaignStore {
  const store = useContext(CampaignContext)
  if (!store) {
    throw new Error('Campaign hooks must be used within a CampaignProvider')
  }
  return store
}

/** Subscribes to a stable selected slice of the campaign store. */
export function useCampaignStoreSelector<T>(
  selector: (snapshot: CampaignStoreSnapshot) => T,
  isEqual: (left: T, right: T) => boolean = Object.is,
): T {
  const store = useCampaignStore()
  const selectorRef = useRef(selector)
  const equalityRef = useRef(isEqual)
  const selectionRef = useRef<{ hasValue: boolean; value?: T }>({
    hasValue: false,
  })
  selectorRef.current = selector
  equalityRef.current = isEqual

  const getSelection = useCallback(() => {
    const nextSelection = selectorRef.current(store.getSnapshot())
    const cached = selectionRef.current
    if (
      !cached.hasValue ||
      !equalityRef.current(cached.value as T, nextSelection)
    ) {
      selectionRef.current = { hasValue: true, value: nextSelection }
    }
    return selectionRef.current.value as T
  }, [store])

  return useSyncExternalStore(store.subscribe, getSelection, getSelection)
}

/** Reads the complete graph for consumers that genuinely render all of it. */
export const useCampaign = () => {
  const store = useCampaignStore()
  const state = useCampaignStoreSelector((snapshot) => snapshot.state)
  return { state, dispatch: store.dispatch }
}

/** Returns stable dispatch-only helpers without subscribing to campaign state. */
export const useCampaignActions = (): CampaignActions => {
  const { dispatch } = useCampaignStore()

  return useMemo(
    () => ({
      setCampaign: (graphData) =>
        dispatch({ type: 'SET_CAMPAIGN', payload: { graphData } }),
      addNode: (newNode) =>
        dispatch({ type: 'ADD_NODE', payload: { newNode } }),
      deleteNode: (nodeId) =>
        dispatch({ type: 'DELETE_NODE', payload: { nodeId } }),
      addEdge: (newEdge) =>
        dispatch({ type: 'ADD_EDGE', payload: { newEdge } }),
      deleteEdge: (edgeId) =>
        dispatch({ type: 'DELETE_EDGE', payload: { edgeId } }),
      updateNodeData: (nodeId, updatedNodeData) =>
        dispatch({
          type: 'UPDATE_NODE_DATA',
          payload: { nodeId, updatedNodeData },
        }),
      updateNodeOutput: (nodeId, updatedOutput) =>
        dispatch({
          type: 'UPDATE_NODE_OUTPUT',
          payload: { nodeId, updatedOutput },
        }),
      clearNodeOutput: (nodeId) =>
        dispatch({ type: 'CLEAR_NODE_OUTPUT', payload: { nodeId } }),
      updateEdgeData: (edgeId, updatedEdgeData) =>
        dispatch({
          type: 'UPDATE_EDGE_DATA',
          payload: { edgeId, updatedEdgeData },
        }),
    }),
    [dispatch],
  )
}
