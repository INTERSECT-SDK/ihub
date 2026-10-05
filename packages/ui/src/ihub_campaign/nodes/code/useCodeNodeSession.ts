import { useEffect, useRef, useState } from 'react'
import type { CodeNode } from '@ihub/utils/types/campaign'
import type {
  JupyterCellOutput,
  JupyterCodeCell,
  JupyterServerKernelConnection,
} from '@ihub/utils/types/notebook'

import {
  createConnectionToJupyterSession,
  runCode,
} from '../../../ihub_notebook/actions'
import { useCampaignActions } from '../../state/campaignContext'
import { useCampaignView } from '../../state/campaignViewContext'
import { selectCodeNodeConnectionTarget } from './codeNodeConnectionTarget'
import { reduceCodeExecutionMessage } from './codeExecutionMessage'

export type CodeCellExecutionState = Record<
  string,
  { isExecuting: boolean; executionCount: number | null }
>

type MultiCellCodeNode = CodeNode & { cells?: JupyterCodeCell[] }

function getCodeNodeCells(data: CodeNode): JupyterCodeCell[] {
  const multiCellData = data as MultiCellCodeNode
  return (
    Array.isArray(multiCellData.cells) && multiCellData.cells.length > 0
      ? multiCellData.cells
      : [data.cell]
  ).filter((cell): cell is JupyterCodeCell => cell != null)
}

function codeCellsAreEqual(
  left: JupyterCodeCell[],
  right: JupyterCodeCell[],
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

/** Owns code-cell compatibility state and the Jupyter execution session. */
export function useCodeNodeSession(id: string, data: CodeNode) {
  const { updateNodeData } = useCampaignActions()
  const { provenanceKey, readOnly, canMutate } = useCampaignView()
  const multiCellData = data as MultiCellCodeNode
  const latestDataRef = useRef(data)
  const hasMultipleCellsRef = useRef(Array.isArray(multiCellData.cells))
  latestDataRef.current = data
  hasMultipleCellsRef.current = Array.isArray(multiCellData.cells)
  const { sessionId, kernelId, serverUrl, serverToken } =
    selectCodeNodeConnectionTarget(data)
  const initialCells = getCodeNodeCells(data)
  const [selectedJupyterSession, setSelectedJupyterSession] =
    useState<JupyterServerKernelConnection>()
  const [cells, setCells] = useState<JupyterCodeCell[]>(initialCells)
  const [activeCellId, setActiveCellId] = useState(
    initialCells[0]?.id || data.cell.id,
  )
  const [executionStateByCell, setExecutionStateByCell] =
    useState<CodeCellExecutionState>(() =>
      Object.fromEntries(
        initialCells.map((cell) => [
          cell.id,
          {
            isExecuting: false,
            executionCount: cell.execution_count ?? null,
          },
        ]),
      ),
    )
  const activeExecRef = useRef<string | null>(null)
  const localProvenanceRef = useRef(provenanceKey)
  const localStateBelongsToView = localProvenanceRef.current === provenanceKey
  const displayedCells =
    readOnly || !localStateBelongsToView ? getCodeNodeCells(data) : cells
  const displayedActiveCellId =
    readOnly || !localStateBelongsToView ? data.cell.id : activeCellId
  const displayedActiveCell =
    displayedCells.find((cell) => cell.id === displayedActiveCellId) ||
    displayedCells[0] ||
    data.cell
  const displayedExecutionStateByCell =
    readOnly || !localStateBelongsToView
      ? Object.fromEntries(
          displayedCells.map((cell) => [
            cell.id,
            {
              isExecuting: false,
              executionCount: cell.execution_count ?? null,
            },
          ]),
        )
      : executionStateByCell

  useEffect(() => {
    const snapshotCells = getCodeNodeCells(latestDataRef.current)
    localProvenanceRef.current = provenanceKey
    setCells(snapshotCells)
    setActiveCellId(snapshotCells[0]?.id || latestDataRef.current.cell.id)
    setExecutionStateByCell(
      Object.fromEntries(
        snapshotCells.map((cell) => [
          cell.id,
          {
            isExecuting: false,
            executionCount: cell.execution_count ?? null,
          },
        ]),
      ),
    )
    activeExecRef.current = null
  }, [provenanceKey])

  useEffect(() => {
    if (!displayedActiveCell) return
    if (!localStateBelongsToView) return
    if (!canMutate(provenanceKey)) return
    const persistedCells = getCodeNodeCells(latestDataRef.current)
    const persistedActiveCell = latestDataRef.current.cell
    if (
      codeCellsAreEqual(cells, persistedCells) &&
      persistedActiveCell?.id === displayedActiveCell.id &&
      persistedActiveCell?.source === displayedActiveCell.source
    ) {
      return
    }
    updateNodeData(id, {
      ...latestDataRef.current,
      cell: displayedActiveCell,
      ...(hasMultipleCellsRef.current ? { cells } : {}),
    } as CodeNode)
  }, [
    canMutate,
    cells,
    displayedActiveCell,
    id,
    localStateBelongsToView,
    provenanceKey,
    updateNodeData,
  ])

  useEffect(() => {
    let isMounted = true
    let connectionToClose: WebSocket | undefined
    setSelectedJupyterSession(undefined)
    if (readOnly) {
      return () => {
        isMounted = false
      }
    }
    const { kernel, server } = latestDataRef.current
    createConnectionToJupyterSession(kernel, server).then((connection) => {
      connectionToClose = connection
      if (isMounted && canMutate(provenanceKey)) {
        setSelectedJupyterSession({
          server,
          session: kernel,
          connection,
        })
      } else {
        connection.close()
      }
    })

    return () => {
      isMounted = false
      connectionToClose?.close()
    }
  }, [
    canMutate,
    kernelId,
    provenanceKey,
    readOnly,
    serverToken,
    serverUrl,
    sessionId,
  ])

  const executeCell = async (
    cellId: string,
    sourceOverride?: string,
  ): Promise<boolean> => {
    const originatingProvenanceKey = provenanceKey
    if (!canMutate(originatingProvenanceKey)) return false
    if (!selectedJupyterSession) {
      alert('Please select a kernel first')
      return false
    }

    const targetCell = cells.find((cell) => cell.id === cellId)
    if (!targetCell) return false
    const sourceToExecute = sourceOverride ?? targetCell.source
    if (!sourceToExecute.trim()) return false

    const cellToExecute = { ...targetCell, source: sourceToExecute }
    setCells((previousCells) =>
      previousCells.map((cell) =>
        cell.id === cellToExecute.id ? { ...cellToExecute, outputs: [] } : cell,
      ),
    )
    setExecutionStateByCell((previousState) => ({
      ...previousState,
      [cellToExecute.id]: {
        isExecuting: true,
        executionCount: previousState[cellToExecute.id]?.executionCount ?? null,
      },
    }))

    const executionId = `${cellToExecute.id}-${Date.now()}`
    activeExecRef.current = executionId
    runCode(
      cellToExecute,
      selectedJupyterSession.session,
      selectedJupyterSession.connection,
      executionId,
    )

    selectedJupyterSession.connection.onmessage = (event: MessageEvent) => {
      if (!canMutate(originatingProvenanceKey)) return
      if (activeExecRef.current !== executionId) return
      const result = reduceCodeExecutionMessage(event.data, executionId)
      if (result.kind === 'invalid-json') {
        console.warn('Non-JSON websocket message', event.data)
        return
      }
      if (result.kind === 'ignored') return

      const { executionCount, isComplete, output } = result.update
      if (executionCount !== undefined || isComplete) {
        setExecutionStateByCell((previousState) => ({
          ...previousState,
          [cellToExecute.id]: {
            isExecuting: isComplete
              ? false
              : (previousState[cellToExecute.id]?.isExecuting ?? false),
            executionCount:
              executionCount ??
              previousState[cellToExecute.id]?.executionCount ??
              null,
          },
        }))
      }
      if (output) {
        setCells((previousCells) =>
          previousCells.map((cell) =>
            cell.id === cellToExecute.id
              ? {
                  ...cell,
                  outputs: [...cell.outputs, output as JupyterCellOutput],
                }
              : cell,
          ),
        )
      }
    }

    return true
  }

  return {
    activeCell: displayedActiveCell,
    activeCellId: displayedActiveCellId,
    cells: displayedCells,
    executeCell,
    executionStateByCell: displayedExecutionStateByCell,
    setActiveCellId,
    setCells,
    provenanceKey,
    readOnly,
    canMutate,
  }
}
