'use client'

/**
 * Provides shared campaign execution state and hooks for tracking overall
 * campaign progress and per-node execution statuses in campaign graph UIs.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useReducer,
} from 'react'

export type CampaignStatus = 'idle' | 'executing' | 'complete'
export type NodeStatus =
  | 'idle'
  | 'waiting'
  | 'executing'
  | 'complete'
  | 'error'
  | 'aborted'

interface ExecutionState {
  campaignStatus: CampaignStatus
  nodeStatuses: Record<string, NodeStatus>
  nodeRunCounts: Record<string, number>
}

type ExecutionAction =
  | { type: 'SET_CAMPAIGN_STATUS'; payload: CampaignStatus }
  | { type: 'SET_NODE_STATUS'; payload: { nodeId: string; status: NodeStatus } }
  | { type: 'RESET' }
  | { type: 'RESTORE'; payload: ExecutionState }

/**
 * Applies campaign execution actions to the current execution state.
 *
 * @param state - Current campaign execution state.
 * @param action - State transition to apply.
 * @returns The next campaign execution state.
 */
function reducer(
  state: ExecutionState,
  action: ExecutionAction,
): ExecutionState {
  switch (action.type) {
    case 'SET_CAMPAIGN_STATUS':
      return { ...state, campaignStatus: action.payload }

    case 'SET_NODE_STATUS':
      return {
        ...state,
        nodeStatuses: {
          ...state.nodeStatuses,
          [action.payload.nodeId]: action.payload.status,
        },
      }

    case 'RESET':
      return { campaignStatus: 'idle', nodeStatuses: {}, nodeRunCounts: {} }

    case 'RESTORE':
      return action.payload

    default:
      return state
  }
}

const defaultState: ExecutionState = {
  campaignStatus: 'idle',
  nodeStatuses: {},
  nodeRunCounts: {},
}

interface ExecutionContextType {
  state: ExecutionState
  setCampaignStatus: (status: CampaignStatus) => void
  setNodeStatus: (nodeId: string, status: NodeStatus) => void
  reset: () => void
  restore: (
    campaignStatus: CampaignStatus,
    nodeStatuses: Record<string, NodeStatus>,
    nodeRunCounts: Record<string, number>,
  ) => void
}

const CampaignExecutionContext = createContext<
  ExecutionContextType | undefined
>(undefined)
const CampaignExecutionDisplayContext = createContext<
  Pick<ExecutionState, 'nodeStatuses' | 'nodeRunCounts'> | undefined
>(undefined)

/** Overrides only the statuses rendered by a campaign view. */
export function CampaignExecutionDisplayProvider({
  children,
  nodeStatuses,
  nodeRunCounts,
}: {
  children: React.ReactNode
  nodeStatuses: Record<string, NodeStatus>
  nodeRunCounts: Record<string, number>
}) {
  return (
    <CampaignExecutionDisplayContext.Provider
      value={{ nodeStatuses, nodeRunCounts }}
    >
      {children}
    </CampaignExecutionDisplayContext.Provider>
  )
}

/**
 * Provides campaign execution state and updater callbacks to descendant
 * components.
 *
 * @param props - Provider props.
 * @param props.children - React subtree that can consume execution state.
 * @returns A React context provider for campaign execution state.
 */
export function CampaignExecutionProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [state, dispatch] = useReducer(reducer, defaultState)

  const setCampaignStatus = useCallback((status: CampaignStatus) => {
    dispatch({ type: 'SET_CAMPAIGN_STATUS', payload: status })
  }, [])

  const setNodeStatus = useCallback((nodeId: string, status: NodeStatus) => {
    dispatch({ type: 'SET_NODE_STATUS', payload: { nodeId, status } })
  }, [])

  const reset = useCallback(() => {
    dispatch({ type: 'RESET' })
  }, [])

  const restore = useCallback(
    (
      campaignStatus: CampaignStatus,
      nodeStatuses: Record<string, NodeStatus>,
      nodeRunCounts: Record<string, number>,
    ) => {
      dispatch({
        type: 'RESTORE',
        payload: { campaignStatus, nodeStatuses, nodeRunCounts },
      })
    },
    [],
  )

  return (
    <CampaignExecutionContext.Provider
      value={{ state, setCampaignStatus, setNodeStatus, reset, restore }}
    >
      {children}
    </CampaignExecutionContext.Provider>
  )
}

/**
 * Reads the current campaign execution context.
 *
 * @returns Campaign execution state and updater callbacks.
 * @throws When used outside of a {@link CampaignExecutionProvider}.
 */
export function useCampaignExecution() {
  const context = useContext(CampaignExecutionContext)
  if (!context) {
    throw new Error(
      'useCampaignExecution must be used within a CampaignExecutionProvider',
    )
  }
  return context
}

/**
 * Reads the execution status for a single campaign node.
 *
 * @param nodeId - Identifier of the node whose execution status should be read.
 * @returns The node status, or `idle` when no status has been recorded.
 */
export function useNodeExecutionStatus(nodeId: string): NodeStatus {
  const { state } = useCampaignExecution()
  const displayState = useContext(CampaignExecutionDisplayContext)
  return (displayState?.nodeStatuses ?? state.nodeStatuses)[nodeId] ?? 'idle'
}

/** Reads how many executions have started for a campaign node. */
export function useNodeExecutionRunCount(nodeId: string): number {
  const { state } = useCampaignExecution()
  const displayState = useContext(CampaignExecutionDisplayContext)
  return (displayState?.nodeRunCounts ?? state.nodeRunCounts)[nodeId] ?? 0
}

/** Reads the statuses selected for the current view without mutating live state. */
export function useCampaignDisplayNodeStatuses(): Record<string, NodeStatus> {
  const { state } = useCampaignExecution()
  return (
    useContext(CampaignExecutionDisplayContext)?.nodeStatuses ??
    state.nodeStatuses
  )
}

/** Reads the execution counts selected for the current campaign view. */
export function useCampaignDisplayNodeRunCounts(): Record<string, number> {
  const { state } = useCampaignExecution()
  return (
    useContext(CampaignExecutionDisplayContext)?.nodeRunCounts ??
    state.nodeRunCounts
  )
}
