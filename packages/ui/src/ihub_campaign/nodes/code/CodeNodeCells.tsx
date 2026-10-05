import { Text } from '@mantine/core'
import type { JupyterCodeCell } from '@ihub/utils/types/notebook'

import { CellInput, CellOutput } from '../../../ihub_notebook'
import * as notebookStyle from '../../../ihub_notebook/style.module.css'
import type { CodeCellExecutionState } from './useCodeNodeSession'

/** Renders code-node cells using the existing notebook editor and output UI. */
export function CodeNodeCells({
  cells,
  activeCellId,
  setCellInput,
  setActiveCellId,
  runCode,
  executionStateByCell,
  readOnly = false,
}: {
  cells: JupyterCodeCell[]
  activeCellId: string
  setCellInput: (cellId: string, input: string) => void
  setActiveCellId: (cellId: string) => void
  runCode: (cellId: string, sourceOverride?: string) => void
  executionStateByCell: CodeCellExecutionState
  readOnly?: boolean
}) {
  return (
    <div style={{ maxHeight: '360px', overflow: 'auto', padding: 12 }}>
      <div
        className={notebookStyle.cellActive}
        style={{ marginBottom: 0, backgroundColor: 'white', padding: 12 }}
      >
        {cells.map((cell) => {
          const status = executionStateByCell[cell.id] || {
            isExecuting: false,
            executionCount: cell.execution_count ?? null,
          }

          return (
            <div key={cell.id} style={{ marginBottom: 10 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '10px',
                  width: '100%',
                  minWidth: 0,
                }}
                onClick={() => setActiveCellId(cell.id)}
              >
                <div
                  style={{
                    minWidth: 'fit-content',
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'flex-start',
                    alignSelf: 'stretch',
                    paddingTop: '2px',
                  }}
                >
                  <CodeNodeStatus
                    executionCount={status.executionCount}
                    isExecuting={status.isExecuting}
                  />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <CellInput
                    cellInput={cell.source}
                    runCode={(sourceOverride?: string) => {
                      if (!readOnly) {
                        runCode(cell.id, sourceOverride)
                      }
                    }}
                    updateCellInput={(input: string) => {
                      if (!readOnly) setCellInput(cell.id, input)
                    }}
                    isActive={cell.id === activeCellId}
                    readOnly={readOnly}
                  />
                </div>
              </div>
              <CellOutput cellId={cell.id} outputs={cell.outputs} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

function CodeNodeStatus({
  executionCount,
  isExecuting,
}: {
  executionCount: number | null
  isExecuting: boolean
}) {
  const promptColor = isExecuting
    ? 'var(--mantine-color-blue-7)'
    : 'var(--mantine-color-dimmed)'
  const promptText = isExecuting
    ? '[*]:'
    : `[${executionCount != null ? executionCount : ' '}]:`

  return (
    <div style={{ textAlign: 'left' }}>
      <Text
        size='xs'
        fw={500}
        ff='monospace'
        c={promptColor}
        style={{ lineHeight: 1 }}
      >
        {promptText}
      </Text>
    </div>
  )
}
