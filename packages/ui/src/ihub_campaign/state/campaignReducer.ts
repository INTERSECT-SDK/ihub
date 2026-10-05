/**
 * Defines the reducer responsible for applying campaign graph mutations to
 * campaign data, including node, edge, and node output updates.
 */

import type {
  CampaignGraphData,
  CampaignEdge,
  CampaignNode,
  CampaignNodeOutputData,
} from '@ihub/utils/types/campaign'

export type CampaignAction =
  | { type: 'SET_CAMPAIGN'; payload: { graphData: CampaignGraphData } }
  | { type: 'ADD_NODE'; payload: { newNode: CampaignNode } }
  | { type: 'DELETE_NODE'; payload: { nodeId: string } }
  | {
      type: 'UPDATE_NODE_DATA'
      payload: {
        nodeId: string
        updatedNodeData: CampaignNode['data']
      }
    }
  | {
      type: 'UPDATE_NODE_OUTPUT'
      payload: {
        nodeId: string
        updatedOutput: CampaignNodeOutputData
      }
    }
  | { type: 'CLEAR_NODE_OUTPUT'; payload: { nodeId: string } }
  | { type: 'ADD_EDGE'; payload: { newEdge: CampaignEdge } }
  | { type: 'DELETE_EDGE'; payload: { edgeId: string } }
  | {
      type: 'UPDATE_EDGE_DATA'
      payload: {
        edgeId: string
        updatedEdgeData: CampaignEdge['data']
      }
    }

/**
 * Applies a campaign graph action to the current campaign data.
 *
 * @param state - Current campaign data containing graph nodes and edges.
 * @param action - Campaign mutation to apply.
 * @returns Updated campaign data, or the original state when the target entity
 * does not exist.
 */
export function campaignReducer(
  state: CampaignGraphData,
  action: CampaignAction,
): CampaignGraphData {
  switch (action.type) {
    case 'SET_CAMPAIGN':
      return action.payload.graphData

    case 'ADD_NODE':
      return {
        ...state,
        nodes: [...state.nodes, action.payload.newNode],
      }

    case 'DELETE_NODE': {
      const nodeExists = state.nodes.some(
        (node) => node.id === action.payload.nodeId,
      )

      if (!nodeExists) {
        return state
      }

      return {
        ...state,
        nodes: state.nodes.filter((node) => node.id !== action.payload.nodeId),
        edges: state.edges.filter(
          (edge) =>
            edge.source !== action.payload.nodeId &&
            edge.target !== action.payload.nodeId,
        ),
      }
    }

    case 'UPDATE_NODE_DATA': {
      const nodeExists = state.nodes.some(
        (node) => node.id === action.payload.nodeId,
      )

      if (!nodeExists) {
        return state
      }

      return {
        ...state,
        nodes: state.nodes.map((node) =>
          node.id === action.payload.nodeId
            ? { ...node, data: action.payload.updatedNodeData }
            : node,
        ),
      }
    }

    case 'UPDATE_NODE_OUTPUT': {
      const nodeExists = state.nodes.some(
        (node) => node.id === action.payload.nodeId,
      )

      if (!nodeExists) {
        return state
      }

      return {
        ...state,
        nodes: state.nodes.map((node) =>
          node.id === action.payload.nodeId
            ? {
                ...node,
                data: {
                  ...node.data,
                  outputs: action.payload.updatedOutput,
                },
              }
            : node,
        ),
      }
    }

    case 'CLEAR_NODE_OUTPUT': {
      const nodeExists = state.nodes.some(
        (node) => node.id === action.payload.nodeId,
      )

      if (!nodeExists) {
        return state
      }

      return {
        ...state,
        nodes: state.nodes.map((node) =>
          node.id === action.payload.nodeId
            ? {
                ...node,
                data: {
                  ...node.data,
                  outputs: [],
                },
              }
            : node,
        ),
      }
    }

    case 'ADD_EDGE':
      return {
        ...state,
        edges: [...state.edges, action.payload.newEdge],
      }

    case 'DELETE_EDGE': {
      const edgeExists = state.edges.some(
        (edge) => edge.id === action.payload.edgeId,
      )

      if (!edgeExists) {
        return state
      }

      return {
        ...state,
        edges: state.edges.filter((edge) => edge.id !== action.payload.edgeId),
      }
    }

    case 'UPDATE_EDGE_DATA': {
      const edgeExists = state.edges.some(
        (edge) => edge.id === action.payload.edgeId,
      )

      if (!edgeExists) {
        return state
      }

      return {
        ...state,
        edges: state.edges.map((edge) =>
          edge.id === action.payload.edgeId
            ? { ...edge, data: action.payload.updatedEdgeData }
            : edge,
        ),
      }
    }
  }
}
