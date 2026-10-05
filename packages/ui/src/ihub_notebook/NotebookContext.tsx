import {
  JupyterNotebookFile,
  JupyterCell,
  JupyterCellOutput,
} from '@ihub/utils/types/notebook'
import React, { createContext, useContext, useReducer } from 'react'

// Define types for actions
type Action =
  | { type: 'SET_NOTEBOOK'; payload: { allNotebookData: JupyterNotebookFile } }
  | { type: 'ADD_CELL_AT_END'; payload: { newCell: JupyterCell } }
  | {
      type: 'ADD_CELL_AT_INDEX'
      payload: { newCell: JupyterCell; insertionIndex: number }
    }
  | {
      type: 'SWAP_CELL_POSITION'
      payload: { currentPosition: number; newPosition: number }
    }
  | { type: 'DELETE_CELL_AT_INDEX'; payload: { cellIndex: number } }
  | {
      type: 'UPDATE_CELL_CODE_AT_INDEX'
      payload: { cellIndex: number; code: string }
    }
  | {
      type: 'UPDATE_CELL_CODE_BY_ID'
      payload: { cellId: string; code: string }
    }
  | { type: 'CLEAR_CELL_OUTPUT_AT_INDEX'; payload: { cellIndex: number } }
  | { type: 'CLEAR_CELL_OUTPUT_BY_ID'; payload: { cellId: string } }
  | {
      type: 'UPDATE_CELL_OUTPUT_AT_INDEX'
      payload: { cellIndex: number; updatedOutput: JupyterCellOutput[] }
    }
  | {
      type: 'UPDATE_CELL_OUTPUT_BY_ID'
      payload: { cellId: string; updatedOutput: JupyterCellOutput[] }
    }

const reducer = (
  state: JupyterNotebookFile,
  action: Action,
): JupyterNotebookFile => {
  switch (action.type) {
    case 'SET_NOTEBOOK':
      return action.payload.allNotebookData

    case 'ADD_CELL_AT_END':
      return {
        ...state,
        content: {
          ...state.content,
          cells: [...state.content.cells, action.payload.newCell],
        },
      }

    case 'ADD_CELL_AT_INDEX':
      return {
        ...state,
        content: {
          ...state.content,
          cells: [
            ...state.content.cells.slice(0, action.payload.insertionIndex),
            action.payload.newCell,
            ...state.content.cells.slice(action.payload.insertionIndex),
          ],
        },
      }

    case 'SWAP_CELL_POSITION':
      var newCellsArr: JupyterCell[] = [...state.content.cells]
      const { currentPosition, newPosition } = action.payload

      if (
        currentPosition < 0 ||
        newPosition < 0 ||
        currentPosition >= newCellsArr.length ||
        newPosition >= newCellsArr.length ||
        currentPosition === newPosition
      ) {
        return state
      }

      const temp = newCellsArr[currentPosition]
      const newCell = newCellsArr[newPosition]

      if (!temp || !newCell) {
        return state
      }

      newCellsArr[currentPosition] = newCell
      newCellsArr[newPosition] = temp
      return {
        ...state,
        content: {
          ...state.content,
          cells: newCellsArr,
        },
      }

    case 'DELETE_CELL_AT_INDEX':
      return {
        ...state,
        content: {
          ...state.content,
          cells: [
            ...state.content.cells.slice(0, action.payload.cellIndex),
            ...state.content.cells.slice(action.payload.cellIndex + 1),
          ],
        },
      }

    case 'UPDATE_CELL_CODE_AT_INDEX':
      var cellCopy = state.content.cells[action.payload.cellIndex]
      if (!cellCopy) {
        throw new Error('cell copy is undefined')
      }
      cellCopy.source = action.payload.code

      return {
        ...state,
        content: {
          ...state.content,
          cells: [
            ...state.content.cells.slice(0, action.payload.cellIndex),
            cellCopy,
            ...state.content.cells.slice(action.payload.cellIndex + 1),
          ],
        },
      }

    case 'UPDATE_CELL_CODE_BY_ID':
      return {
        ...state,
        content: {
          ...state.content,
          cells: state.content.cells.map((cell) => {
            if (cell.id !== action.payload.cellId) {
              return cell
            }

            return {
              ...cell,
              source: action.payload.code,
            }
          }),
        },
      }

    case 'CLEAR_CELL_OUTPUT_AT_INDEX':
      var cellCopy = state.content.cells[action.payload.cellIndex]

      if (!cellCopy) {
        throw new Error('cell copy is undefined')
      }
      if (cellCopy.cell_type !== 'code') {
        return state
      }

      cellCopy.outputs = []

      return {
        ...state,
        content: {
          ...state.content,
          cells: [
            ...state.content.cells.slice(0, action.payload.cellIndex),
            cellCopy,
            ...state.content.cells.slice(action.payload.cellIndex + 1),
          ],
        },
      }

    case 'CLEAR_CELL_OUTPUT_BY_ID':
      return {
        ...state,
        content: {
          ...state.content,
          cells: state.content.cells.map((cell) => {
            if (
              cell.id !== action.payload.cellId ||
              cell.cell_type !== 'code'
            ) {
              return cell
            }

            return {
              ...cell,
              outputs: [],
            }
          }),
        },
      }

    case 'UPDATE_CELL_OUTPUT_AT_INDEX':
      var cellCopy = state.content.cells[action.payload.cellIndex]

      if (!cellCopy) {
        throw new Error('cell copy is undefined')
      }
      if (cellCopy.cell_type !== 'code') {
        return state
      }
      cellCopy.outputs = action.payload.updatedOutput

      return {
        ...state,
        content: {
          ...state.content,
          cells: [
            ...state.content.cells.slice(0, action.payload.cellIndex),
            cellCopy,
            ...state.content.cells.slice(action.payload.cellIndex + 1),
          ],
        },
      }

    case 'UPDATE_CELL_OUTPUT_BY_ID':
      return {
        ...state,
        content: {
          ...state.content,
          cells: state.content.cells.map((cell) => {
            if (
              cell.id !== action.payload.cellId ||
              cell.cell_type !== 'code'
            ) {
              return cell
            }

            return {
              ...cell,
              outputs: action.payload.updatedOutput,
            }
          }),
        },
      }

    default:
      return state
  }
}

// Define the initial state
const defaultValue: JupyterNotebookFile = {
  type: 'notebook',
  format: 'json',
  name: 'empty_notebook',
  content: {
    cells: [],
    metadata: {},
    nbformat: -1,
    nbformat_minor: -1,
  },
}

// Define the context type
interface ContextType {
  state: JupyterNotebookFile | undefined
  dispatch: React.Dispatch<Action>
}

// Create a context
// Create a context with a default value as `undefined` to start
export const JupyterNotebookContext = createContext<ContextType | undefined>(
  undefined,
)

// Context Provider Component
export const JupyterNotebookProvider = ({
  children,
}: {
  children: React.ReactNode
}) => {
  const [state, dispatch] = useReducer(reducer, defaultValue)

  return (
    <JupyterNotebookContext.Provider value={{ state, dispatch }}>
      {children}
    </JupyterNotebookContext.Provider>
  )
}

// Custom hook to use the JupyterNotebookContext
export const useJupyterNotebook = () => {
  const context = useContext(JupyterNotebookContext)
  if (!context) {
    throw new Error(
      'useJupyterNotebook must be used within a JupyterNotebookContext',
    )
  }
  return context
}

// swap the position of two cells
export const useSwapCellPosition = () => {
  const { state, dispatch } = useJupyterNotebook()

  const handleAction = (currentPosition: number, newPosition: number) => {
    dispatch({
      type: 'SWAP_CELL_POSITION',
      payload: { currentPosition: currentPosition, newPosition: newPosition },
    })
  }

  return { handleAction }
}

// set the entire content of the jupyter notebook
export const useSetJupyterNotebook = () => {
  const { state, dispatch } = useJupyterNotebook()

  const handleAction = (allNoteBookData: JupyterNotebookFile) => {
    dispatch({
      type: 'SET_NOTEBOOK',
      payload: { allNotebookData: allNoteBookData },
    })
  }
  return { handleAction }
}

// add a cell at the end of the notebook
export const useAddCellAtEnd = () => {
  const { state, dispatch } = useJupyterNotebook()

  const handleAction = (newCell: JupyterCell) => {
    dispatch({ type: 'ADD_CELL_AT_END', payload: { newCell: newCell } })
  }
  return { handleAction }
}

// add a cell at index i
export const useAddCellAtIndex = () => {
  const { state, dispatch } = useJupyterNotebook()

  const handleAction = (newCell: JupyterCell, insertionIndex: number) => {
    dispatch({
      type: 'ADD_CELL_AT_INDEX',
      payload: { newCell: newCell, insertionIndex: insertionIndex },
    })
  }
  return { handleAction }
}

// delete cell at index i
export const useDeleteCellAtIndex = () => {
  const { state, dispatch } = useJupyterNotebook()

  const handleAction = (cellIndex: number) => {
    dispatch({
      type: 'DELETE_CELL_AT_INDEX',
      payload: { cellIndex: cellIndex },
    })
  }
  return { handleAction }
}

// update cell code at index i
export const useUpdateCellCodeAtIndex = () => {
  const { state, dispatch } = useJupyterNotebook()

  const handleAction = (cellIndex: number, code: string) => {
    dispatch({
      type: 'UPDATE_CELL_CODE_AT_INDEX',
      payload: { cellIndex: cellIndex, code: code },
    })
  }
  return { handleAction }
}

// update cell code by id
export const useUpdateCellCodeById = () => {
  const { state, dispatch } = useJupyterNotebook()

  const handleAction = (cellId: string, code: string) => {
    dispatch({
      type: 'UPDATE_CELL_CODE_BY_ID',
      payload: { cellId: cellId, code: code },
    })
  }

  return { handleAction }
}

// clear cell output at index i
export const useClearCellOutputAtIndex = () => {
  const { state, dispatch } = useJupyterNotebook()

  const handleAction = (cellIndex: number) => {
    dispatch({
      type: 'CLEAR_CELL_OUTPUT_AT_INDEX',
      payload: { cellIndex: cellIndex },
    })
  }
  return { handleAction }
}

// clear code cell output by id
export const useClearCellOutputById = () => {
  const { state, dispatch } = useJupyterNotebook()

  const handleAction = (cellId: string) => {
    dispatch({
      type: 'CLEAR_CELL_OUTPUT_BY_ID',
      payload: { cellId: cellId },
    })
  }

  return { handleAction }
}

// set cell output at index i
export const useSetCellOutputAtIndex = () => {
  const { state, dispatch } = useJupyterNotebook()

  const handleAction = (
    cellIndex: number,
    updatedOutput: JupyterCellOutput[],
  ) => {
    dispatch({
      type: 'UPDATE_CELL_OUTPUT_AT_INDEX',
      payload: { cellIndex: cellIndex, updatedOutput: updatedOutput },
    })
  }
  return { handleAction }
}

// set code cell output by id
export const useSetCellOutputById = () => {
  const { state, dispatch } = useJupyterNotebook()

  const handleAction = (cellId: string, updatedOutput: JupyterCellOutput[]) => {
    dispatch({
      type: 'UPDATE_CELL_OUTPUT_BY_ID',
      payload: { cellId: cellId, updatedOutput: updatedOutput },
    })
  }

  return { handleAction }
}

/**
 *
 *
 * FUNCTIONS TO RECREATE ALL GO HERE
 *
 *
 */
