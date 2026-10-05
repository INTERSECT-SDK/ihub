'use client'

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import {
  useAddCellAtIndex,
  useClearCellOutputById,
  useDeleteCellAtIndex,
  useJupyterNotebook,
  useSetCellOutputById,
  useSwapCellPosition,
  useUpdateCellCodeById,
} from './NotebookContext'
import {
  ActionIcon,
  Card,
  Group,
  Text,
  useMantineColorScheme,
} from '@mantine/core'
import { generateInsecureUUID } from '@ihub/utils/helpers/helpers'
import {
  JupyterCell,
  JupyterCellOutput,
  JupyterCodeCell,
  JupyterMarkdownCell,
  JupyterOutputError,
  JupyterOutputExecResult,
  JupyterOutputStream,
  JupyterServerConfig,
  JupyterServerKernelConnection,
  JupyterServerKernelSession,
  JupyterSession,
} from '@ihub/utils/types/notebook'
import {
  IHubIconInsertAbove,
  IHubIconInsertBelow,
  IHubIconMoveDown,
  IHubIconMoveUp,
  IHubIconPlay,
  IHubIconTrash,
} from '@ihub/utils/icons'
import AnsiToHtml from 'ansi-to-html'
import { Editor } from '@monaco-editor/react'
import * as style from './style.module.css'
import { runCode } from './actions'
import ReactMarkdown from 'react-markdown'

// import Plot from 'react-plotly.js';

interface MarkdownCellProps {
  cellContent: JupyterMarkdownCell
  isActive: boolean
  setActiveCellId: any
  cellIndex: number
}

interface CodeCellProps {
  cellContent: JupyterCodeCell
  jupyterSession: JupyterServerKernelConnection | null
  isActive: boolean
  setActiveCellId: any
  cellIndex: number
  nextCellId: string | null
  onExecutionChange?: (cellId: string, active: boolean) => void
}

type CellProps = CodeCellProps | MarkdownCellProps

export function NotebookMarkdownCell({
  cellContent,
  isActive,
  setActiveCellId,
  cellIndex,
}: MarkdownCellProps) {
  return (
    <Card
      data-cell-id={cellContent.id}
      className={isActive ? style.cellActive : style.cell}
      onDoubleClick={() => {
        setActiveCellId(cellContent.id)
      }}
    >
      <Group justify='space-between'>
        <div style={{ paddingLeft: '10px', paddingRight: '10px' }}></div>

        <div
          className={isActive ? style.cellControlsActive : style.cellControls}
        >
          <CellControlBar
            cellId={cellContent.id}
            runCode={() => {
              setActiveCellId(null)
            }}
            key={`control-bar-${cellContent.id}`}
            cellIndex={cellIndex}
          />
        </div>
      </Group>
      {isActive ? (
        <CellCode
          cellId={cellContent.id}
          cellIndex={cellIndex}
          cellInput={cellContent.source}
          runCode={() => setActiveCellId(null)}
          onSourceChange={() => {}}
          isActive={isActive}
        />
      ) : (
        <ReactMarkdown>{cellContent.source}</ReactMarkdown>
      )}
    </Card>
  )
}

export function NotebookCodeCell({
  cellContent,
  jupyterSession,
  isActive,
  setActiveCellId,
  cellIndex,
  nextCellId,
  onExecutionChange,
}: CodeCellProps) {
  /**
   * A computational notebook component should have:
   * cell input (required)
   * cell output (required)
   * cell status (optional)
   * cell control bar (optional)
   */

  const { handleAction: clearCellOutputById } = useClearCellOutputById()
  const { handleAction: setCellOutputById } = useSetCellOutputById()
  const { handleAction: syncCellCodeById } = useUpdateCellCodeById()
  const { handleAction: addCellAtIndex } = useAddCellAtIndex()
  const { state: notebookState } = useJupyterNotebook()

  const bufferRef = useRef<any[]>([])
  const outputAccumulatorRef = useRef<JupyterCellOutput[]>([])
  const executingCellIdRef = useRef<string | null>(null)
  const executionActiveRef = useRef(false)
  const executionCleanupRef = useRef<(() => void) | null>(null)
  const onExecutionChangeRef = useRef(onExecutionChange)
  const latestSourceRef = useRef(cellContent.source)
  const [displayOutputs, setDisplayOutputs] = useState<JupyterCellOutput[]>(
    cellContent.outputs || [],
  )
  const [isExecuting, setIsExecuting] = useState(false)
  const [executionCount, setExecutionCount] = useState<number | null>(
    cellContent.execution_count ?? null,
  )
  const messageHandlersRef = useRef<Set<(event: MessageEvent) => void>>(
    new Set(),
  )

  const flushInterval = 100

  const flushOutputBuffer = useCallback(() => {
    if (bufferRef.current.length === 0) {
      return
    }

    const targetCellId = executingCellIdRef.current || cellContent.id
    outputAccumulatorRef.current = [
      ...outputAccumulatorRef.current,
      ...bufferRef.current,
    ]
    setDisplayOutputs(outputAccumulatorRef.current)
    setCellOutputById(targetCellId, outputAccumulatorRef.current)
    bufferRef.current = []
  }, [cellContent.id, setCellOutputById])

  useEffect(() => {
    const interval = setInterval(() => {
      flushOutputBuffer()
    }, flushInterval)

    return () => clearInterval(interval)
  }, [flushInterval, flushOutputBuffer])

  useEffect(() => {
    latestSourceRef.current = cellContent.source
  }, [cellContent.source])

  useEffect(() => {
    onExecutionChangeRef.current = onExecutionChange
  }, [onExecutionChange])

  const setExecutionActive = useCallback(
    (active: boolean) => {
      if (executionActiveRef.current === active) {
        return
      }

      executionActiveRef.current = active
      setIsExecuting(active)
      onExecutionChangeRef.current?.(cellContent.id, active)
    },
    [cellContent.id],
  )

  useEffect(() => {
    const connection = jupyterSession?.connection
    const messageHandlers = messageHandlersRef.current

    return () => {
      executionCleanupRef.current?.()
      executionCleanupRef.current = null

      if (connection) {
        messageHandlers.forEach((handler) => {
          connection.removeEventListener('message', handler)
        })
        messageHandlers.clear()
      }

      setExecutionActive(false)
    }
  }, [jupyterSession, setExecutionActive])

  useEffect(() => {
    setExecutionCount(cellContent.execution_count ?? null)
  }, [cellContent.execution_count])

  useEffect(() => {
    setDisplayOutputs(cellContent.outputs || [])
  }, [cellContent.id, cellContent.outputs])

  const execute = async (sourceOverride?: string): Promise<boolean> => {
    if (jupyterSession === null) {
      alert('Please select a kernel first')
      return false
    }
    if (executionActiveRef.current) {
      return false
    }

    const liveCell = (notebookState?.content?.cells || []).find(
      (cell): cell is JupyterCodeCell =>
        cell.id === cellContent.id && cell.cell_type === 'code',
    )
    const sourceToRun =
      sourceOverride ??
      latestSourceRef.current ??
      liveCell?.source ??
      cellContent.source

    // Do not execute empty code cells.
    if (!sourceToRun.trim()) {
      return false
    }

    latestSourceRef.current = sourceToRun
    const cellToRun: JupyterCodeCell = {
      ...(liveCell || cellContent),
      source: sourceToRun,
    }
    const targetCellId = cellToRun.id

    // Keep reducer state synchronized with the exact source being executed.
    syncCellCodeById(targetCellId, sourceToRun)

    setExecutionActive(true)
    clearCellOutputById(targetCellId)
    setDisplayOutputs([])
    bufferRef.current = []
    outputAccumulatorRef.current = []
    executingCellIdRef.current = targetCellId

    const exec_id = `${targetCellId}-${Date.now()}`
    const connection = jupyterSession.connection
    let hasFinished = false

    function finishExecution(flushBufferedOutput: boolean) {
      if (hasFinished) {
        return
      }

      hasFinished = true
      if (flushBufferedOutput) {
        flushOutputBuffer()
      }
      setExecutionActive(false)
      executingCellIdRef.current = null
      connection.removeEventListener('message', handleMessage)
      connection.removeEventListener('close', handleConnectionEnd)
      connection.removeEventListener('error', handleConnectionEnd)
      messageHandlersRef.current.delete(handleMessage)
      if (executionCleanupRef.current === cleanupExecution) {
        executionCleanupRef.current = null
      }
    }

    function handleMessage(event: MessageEvent) {
      let msg
      try {
        msg = JSON.parse(event.data)
      } catch (err) {
        console.warn('Non-JSON websocket message', event.data)
        return
      }

      // check if the message is a response to this cell
      if (msg?.parent_header?.msg_id !== exec_id) {
        return
      }

      const msgType = msg?.header?.msg_type
      let msgToBuffer: JupyterCellOutput | null = null
      const kernelExecutionCount = msg?.content?.execution_count

      if (typeof kernelExecutionCount === 'number') {
        setExecutionCount(kernelExecutionCount)
      }

      switch (msgType) {
        case 'stream':
          msgToBuffer = {
            output_type: 'stream',
            name: msg.content.name,
            text: msg.content.text,
          } as JupyterOutputStream
          break

        case 'execute_result':
          msgToBuffer = {
            output_type: 'execute_result',
            execution_count: msg.content.execution_count,
            data: msg.content.data,
            metadata: msg.content.metadata,
          } as JupyterOutputExecResult
          break

        case 'error':
          msgToBuffer = {
            output_type: 'error',
            ename: msg.content.ename,
            evalue: msg.content.evalue,
            traceback: msg.content.traceback,
          } as JupyterOutputError
          break

        case 'display_data':
          msgToBuffer = {
            output_type: 'display_data',
            data: msg.content.data,
            metadata: msg.content.metadata,
          } as any
          break
      }

      if (msgToBuffer) {
        bufferRef.current.push(msgToBuffer)
      }

      if (msgType === 'execute_reply' || msgType === 'error') {
        finishExecution(true)
      }
    }

    function handleConnectionEnd() {
      finishExecution(false)
    }

    function cleanupExecution() {
      finishExecution(false)
    }

    connection.addEventListener('message', handleMessage)
    connection.addEventListener('close', handleConnectionEnd)
    connection.addEventListener('error', handleConnectionEnd)
    messageHandlersRef.current.add(handleMessage)
    executionCleanupRef.current = cleanupExecution

    try {
      const executionResult = await runCode(
        cellToRun,
        jupyterSession.session,
        connection,
        exec_id,
      )

      if (executionResult?.error) {
        finishExecution(false)
        return false
      }
    } catch (error) {
      console.error('Notebook cell execution failed:', error)
      finishExecution(false)
      return false
    }

    return true
  }
  const handleShiftEnter = async (sourceOverride?: string) => {
    if (jupyterSession === null) return

    const didExecute = await execute(sourceOverride)
    if (!didExecute) return

    const activeElement = document.activeElement as HTMLElement | null
    const currentCard = activeElement?.closest(
      '[data-cell-id]',
    ) as HTMLElement | null
    let nextCard = currentCard?.nextElementSibling as HTMLElement | null

    while (nextCard && !nextCard.getAttribute('data-cell-id')) {
      nextCard = nextCard.nextElementSibling as HTMLElement | null
    }

    const domNextCellId = nextCard?.getAttribute('data-cell-id')
    if (domNextCellId) {
      setActiveCellId(domNextCellId)
      return
    }

    const cells = notebookState?.content?.cells || []
    const liveIndex = cells.findIndex((cell) => cell.id === cellContent.id)
    const liveNextCellId =
      liveIndex >= 0 && liveIndex < cells.length - 1
        ? cells[liveIndex + 1]?.id || null
        : null

    const resolvedNextCellId = liveNextCellId || nextCellId

    if (resolvedNextCellId) {
      setActiveCellId(resolvedNextCellId)
      return
    }

    // Only insert a new cell when we can confirm
    // the currently executed cell is the final cell.
    if (liveIndex >= 0 && liveIndex !== cells.length - 1) {
      return
    }

    const newCodeCell: JupyterCell = {
      id: generateInsecureUUID(),
      cell_type: 'code',
      execution_count: null,
      metadata: {},
      outputs: [],
      source: '',
    }

    const insertionIndex = liveIndex >= 0 ? liveIndex + 1 : cellIndex + 1
    addCellAtIndex(newCodeCell, insertionIndex)
    setActiveCellId(newCodeCell.id)
  }

  return (
    <Card
      data-cell-id={cellContent.id}
      className={isActive ? style.cellActive : style.cell}
      onClick={() => setActiveCellId(cellContent.id)}
    >
      <Group justify='flex-end'>
        <div
          className={isActive ? style.cellControlsActive : style.cellControls}
        >
          <CellControlBar
            cellId={cellContent.id}
            runCode={handleShiftEnter}
            key={`control-bar-${cellContent.id}`}
            cellIndex={cellIndex}
          />
        </div>
      </Group>

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
        <div
          style={{
            width: '72px',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'flex-end',
            alignSelf: 'stretch',
            paddingTop: '2px',
          }}
        >
          <CellStatus
            executionCount={executionCount}
            isExecuting={isExecuting}
          />
        </div>

        <div style={{ flex: 1 }}>
          <CellCode
            cellId={cellContent.id}
            cellIndex={cellIndex}
            cellInput={cellContent.source}
            runCode={handleShiftEnter}
            onSourceChange={(nextSource) => {
              latestSourceRef.current = nextSource
            }}
            isActive={isActive}
          />
        </div>
      </div>

      <CellOutput cellId={cellContent.id} outputs={displayOutputs} />
    </Card>
  )
}

interface CellStatusProps {
  executionCount: number | null
  isExecuting: boolean
}

export function CellStatus({ executionCount, isExecuting }: CellStatusProps) {
  const promptColor = isExecuting
    ? 'var(--mantine-color-blue-7)'
    : 'var(--mantine-color-dimmed)'
  const promptText = isExecuting
    ? '[*]:'
    : `[${executionCount != null ? executionCount : ' '}]:`

  return (
    <div style={{ minWidth: 64, textAlign: 'right' }}>
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

export function CellCode({
  cellId,
  cellIndex,
  cellInput,
  runCode,
  onSourceChange,
  isActive,
}: {
  cellId: string
  cellIndex: number
  cellInput: string
  runCode: (sourceOverride?: string) => void
  onSourceChange: (nextSource: string) => void
  isActive: boolean
}) {
  const { handleAction: updateCellCodeById } = useUpdateCellCodeById()

  return (
    <div className={style.editorContainer}>
      <CellInput
        key={`${cellId}-${cellIndex}`}
        cellInput={cellInput}
        updateCellInput={(newValue: string) => {
          const nextSource = newValue || ''
          onSourceChange(nextSource)
          updateCellCodeById(cellId, nextSource)
        }}
        runCode={runCode}
        isActive={isActive}
      />
    </div>
  )
}

interface CellInputProps {
  cellInput: string
  updateCellInput: any
  runCode: (sourceOverride?: string) => void
  isActive: boolean
  readOnly?: boolean
}

export function CellInput({
  cellInput,
  updateCellInput,
  runCode,
  isActive,
  readOnly = false,
}: CellInputProps) {
  const { colorScheme } = useMantineColorScheme()
  const [editorHeight, setEditorHeight] = useState(40)

  const editorRef = useRef<any | null>(null)
  const runCodeRef = useRef(runCode)
  const pendingAnimationFrame = useRef<number | null>(null)
  const editorDisposedRef = useRef(false)
  const editorDisposablesRef = useRef<any[]>([])

  useEffect(() => {
    runCodeRef.current = runCode
  }, [runCode])

  const updateEditorHeight = useCallback(() => {
    const editor = editorRef.current
    if (!editor || editorDisposedRef.current) return

    try {
      if (!editor.getModel?.() || !editor.getDomNode?.()) {
        return
      }

      const nextHeight = Math.max(40, Math.ceil(editor.getContentHeight()))
      setEditorHeight((prevHeight) =>
        prevHeight === nextHeight ? prevHeight : nextHeight,
      )
      editor.layout({
        width: editor.getLayoutInfo().width,
        height: nextHeight,
      })
    } catch {
      // Monaco may be disposed while async callbacks are still in flight.
    }
  }, [])

  useEffect(() => {
    const scheduleUpdate = () => {
      if (pendingAnimationFrame.current !== null) {
        cancelAnimationFrame(pendingAnimationFrame.current)
      }

      pendingAnimationFrame.current = requestAnimationFrame(() => {
        pendingAnimationFrame.current = null
        updateEditorHeight()
      })
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        scheduleUpdate()
      }
    }

    window.addEventListener('resize', scheduleUpdate)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener('resize', scheduleUpdate)
      document.removeEventListener('visibilitychange', handleVisibilityChange)

      if (pendingAnimationFrame.current !== null) {
        cancelAnimationFrame(pendingAnimationFrame.current)
      }
    }
  }, [updateEditorHeight])

  useEffect(() => {
    updateEditorHeight()
  }, [cellInput, updateEditorHeight])

  useEffect(() => {
    if (isActive) {
      if (!editorDisposedRef.current) {
        editorRef.current?.focus()
      }
    }
  }, [isActive])

  useEffect(() => {
    return () => {
      editorDisposedRef.current = true
      editorRef.current = null

      editorDisposablesRef.current.forEach((disposable) => {
        disposable?.dispose?.()
      })
      editorDisposablesRef.current = []
    }
  }, [])

  return (
    <Editor
      height={`${editorHeight}px`}
      defaultLanguage='python'
      theme={colorScheme === 'dark' ? 'vs-dark' : 'vs'}
      value={cellInput}
      onMount={(editor, monaco) => {
        editorDisposedRef.current = false
        editorDisposablesRef.current.forEach((disposable) => {
          disposable?.dispose?.()
        })
        editorDisposablesRef.current = []
        editorRef.current = editor

        const scheduleUpdate = () => {
          if (editorDisposedRef.current) {
            return
          }

          if (pendingAnimationFrame.current !== null) {
            cancelAnimationFrame(pendingAnimationFrame.current)
          }

          pendingAnimationFrame.current = requestAnimationFrame(() => {
            pendingAnimationFrame.current = null
            if (editorDisposedRef.current) {
              return
            }
            updateEditorHeight()
          })
        }

        updateEditorHeight()
        scheduleUpdate()

        editorDisposablesRef.current.push(
          editor.onDidDispose(() => {
            editorDisposedRef.current = true
            editorRef.current = null

            if (pendingAnimationFrame.current !== null) {
              cancelAnimationFrame(pendingAnimationFrame.current)
              pendingAnimationFrame.current = null
            }
          }),
        )

        if (isActive) {
          requestAnimationFrame(() => {
            if (editorDisposedRef.current) {
              return
            }
            editor.focus()
          })
        }

        editorDisposablesRef.current.push(
          editor.onDidChangeModelContent(() => {
            if (editorDisposedRef.current || readOnly) {
              return
            }

            const nextSource = editor.getValue()
            updateCellInput(nextSource)
            scheduleUpdate()
          }),
        )
        editorDisposablesRef.current.push(
          editor.onDidContentSizeChange(scheduleUpdate),
        )

        // TODO: save content on control+S
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
          if (editorDisposedRef.current) {
            return
          }
          console.log('Ctrl+S Pressed!')
          console.log('TODO: save')
        })
        // run code on Shift+Enter
        editor.onKeyDown((event) => {
          if (readOnly) return
          if (event.keyCode !== monaco.KeyCode.Enter || !event.shiftKey) {
            return
          }

          event.preventDefault()
          event.stopPropagation()

          window.setTimeout(() => {
            if (editorDisposedRef.current) {
              return
            }

            const sourceAtRun =
              editor.getModel()?.getValue() || editor.getValue() || ''
            updateCellInput(sourceAtRun)
            runCodeRef.current(sourceAtRun)
          }, 25)
        })
      }}
      options={{
        readOnly,
        fontSize: 14,
        lineNumbers: 'off',
        lineNumbersMinChars: 0,
        glyphMargin: false,
        folding: false,
        minimap: { enabled: false },
        wordWrap: 'on',
        scrollbar: {
          vertical: 'hidden',
          horizontal: 'hidden',
        },
        padding: { top: 0, bottom: 0 },
        overviewRulerLanes: 0,
        scrollBeyondLastLine: false,
        automaticLayout: true,
      }}
    />
  )
}

interface CellOutputProps {
  cellId: string
  outputs: JupyterCellOutput[]
}
export const CellOutput = memo(function CellOutput({
  cellId,
  outputs,
}: CellOutputProps) {
  const normalizeText = (value: unknown): string => {
    if (Array.isArray(value)) {
      return value.join('')
    }

    if (typeof value === 'string') {
      return value
    }

    return ''
  }

  function renderOutput(output: JupyterCellOutput, i: number) {
    const converter = new AnsiToHtml()

    switch (output.output_type) {
      case 'stream':
        return (
          <pre
            key={`output-${i}`}
            style={{
              display: 'block',
              width: '100%',
              minWidth: 0,
              boxSizing: 'border-box',
              marginTop: '10px',
              whiteSpace: 'pre',
              overflowX: 'auto',
            }}
          >
            {normalizeText((output as any).text)}
          </pre>
        )

      case 'error':
        return (
          <div
            key={`output-${i}`}
            style={{
              padding: '10px',
              marginTop: '10px',
              marginBottom: '10px',
              backgroundColor: 'var(--mantine-color-red-3)',
            }}
          >
            <pre
              style={{
                display: 'block',
                width: '100%',
                minWidth: 0,
                boxSizing: 'border-box',
                whiteSpace: 'pre',
                overflowX: 'auto',
              }}
            >
              <b>{output.ename}: </b>
              {output.evalue}
            </pre>
            {output.traceback?.map((tb: string, tbi: number) => (
              <div
                key={`error-traceback-${i}-${tbi}`}
                style={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}
                dangerouslySetInnerHTML={{ __html: converter.toHtml(tb) }}
              />
            ))}
          </div>
        )

      case 'display_data': {
        const data = output.data || {}

        // if (data['application/vnd.plotly.v1+json']) {
        //     const plotlyData = data['application/vnd.plotly.v1+json']
        //     return (
        //         <Plot
        //             key={`output-${i}`}
        //             data={plotlyData.data || []}
        //             layout={plotlyData.layout || {}}
        //             config={plotlyData.config || {}}
        //             style={{ width: '100%', height: '100%', marginTop: '10px' }}
        //             useResizeHandler
        //         />
        //     )
        // }

        if (data['image/png']) {
          return (
            <img
              key={`output-${i}`}
              src={`data:image/png;base64,${data['image/png']}`}
              alt='Jupyter output'
              style={{ maxWidth: '100%', marginTop: '10px' }}
            />
          )
        }

        if (data['image/jpeg']) {
          return (
            <img
              key={`output-${i}`}
              src={`data:image/jpeg;base64,${data['image/jpeg']}`}
              alt='Jupyter output'
              style={{ maxWidth: '100%', marginTop: '10px' }}
            />
          )
        }
        if (data['image/svg+xml']) {
          return (
            <div
              key={`output-${i}`}
              style={{ marginTop: '10px' }}
              dangerouslySetInnerHTML={{ __html: data['image/svg+xml'] }}
            />
          )
        }
        if (data['text/html']) {
          return (
            <div
              key={`output-${i}`}
              style={{ marginTop: '10px' }}
              dangerouslySetInnerHTML={{
                __html: Array.isArray(data['text/html'])
                  ? data['text/html'].join('')
                  : data['text/html'],
              }}
            />
          )
        }

        if (data['text/plain']) {
          return (
            <pre
              key={`output-${i}`}
              style={{
                display: 'block',
                width: '100%',
                minWidth: 0,
                boxSizing: 'border-box',
                marginTop: '10px',
                whiteSpace: 'pre',
                overflowX: 'auto',
              }}
            >
              {Array.isArray(data['text/plain'])
                ? data['text/plain'].join('')
                : data['text/plain']}
            </pre>
          )
        }
        return (
          <pre
            key={`output-${i}`}
            style={{
              display: 'block',
              width: '100%',
              minWidth: 0,
              boxSizing: 'border-box',
              marginTop: '10px',
              whiteSpace: 'pre',
              overflowX: 'auto',
            }}
          >
            [Unsupported MIME types: {Object.keys(data).join(', ') || 'none'}]
          </pre>
        )
      }

      default:
        return
    }
  }

  return <div>{outputs?.map((output, i) => renderOutput(output, i))}</div>
}, areCellOutputsEqual)

function areCellOutputsEqual(
  prevProps: CellOutputProps,
  nextProps: CellOutputProps,
) {
  return (
    prevProps.cellId === nextProps.cellId &&
    prevProps.outputs === nextProps.outputs
  )
}

interface CellControlBarProps {
  cellId: string
  cellIndex: number
  runCode: any
}

export function CellControlBar({
  cellId,
  cellIndex,
  runCode,
}: CellControlBarProps) {
  const { state: notebookState } = useJupyterNotebook()
  const { handleAction: addCellAtIndex } = useAddCellAtIndex()
  const { handleAction: swapCellPosition } = useSwapCellPosition()
  const { handleAction: deleteCellAtIndex } = useDeleteCellAtIndex()
  const cells = notebookState?.content?.cells || []
  const resolvedCellIndex = cells.findIndex((cell) => cell.id === cellId)
  const effectiveCellIndex =
    resolvedCellIndex >= 0 ? resolvedCellIndex : cellIndex
  const totalCells = cells.length
  const canMoveUp = effectiveCellIndex > 0
  const canMoveDown = effectiveCellIndex < totalCells - 1
  const effectiveCell =
    effectiveCellIndex >= 0 ? cells[effectiveCellIndex] : undefined
  const canRun =
    effectiveCell?.cell_type !== 'code' ||
    Boolean((effectiveCell.source || '').trim())

  const addCodeCell = (position: 'before' | 'after') => {
    const newCodeCell: JupyterCell = {
      id: generateInsecureUUID(),
      cell_type: 'code',
      execution_count: null,
      metadata: {},
      outputs: [],
      source: '',
    }

    switch (position) {
      case 'before':
        addCellAtIndex(newCodeCell, Math.max(0, effectiveCellIndex))
        break

      case 'after':
        addCellAtIndex(newCodeCell, effectiveCellIndex + 1)
        break
    }
  }

  const moveCell = (direction: 'up' | 'down') => {
    switch (direction) {
      case 'up':
        if (!canMoveUp) return
        swapCellPosition(effectiveCellIndex, effectiveCellIndex - 1)
        break

      case 'down':
        if (!canMoveDown) return
        swapCellPosition(effectiveCellIndex, effectiveCellIndex + 1)
        break
    }
  }

  return (
    <div>
      <Group justify='flex-end' gap='xs'>
        <ActionIcon
          variant='subtle'
          size={'sm'}
          p={4}
          disabled={!canMoveUp}
          onClick={() => moveCell('up')}
        >
          <IHubIconMoveUp stroke={1} />
        </ActionIcon>

        <ActionIcon
          variant='subtle'
          size='sm'
          p={4}
          disabled={!canMoveDown}
          onClick={() => moveCell('down')}
        >
          <IHubIconMoveDown stroke={1} />
        </ActionIcon>

        <ActionIcon
          variant='subtle'
          size='sm'
          p={4}
          onClick={() => addCodeCell('before')}
        >
          <IHubIconInsertAbove stroke={1} />
        </ActionIcon>

        <ActionIcon
          variant='subtle'
          size='sm'
          p={4}
          onClick={() => addCodeCell('after')}
        >
          <IHubIconInsertBelow stroke={1} />
        </ActionIcon>

        <ActionIcon
          variant='subtle'
          size='sm'
          p={4}
          onClick={() => deleteCellAtIndex(effectiveCellIndex)}
        >
          <IHubIconTrash stroke={1} />
        </ActionIcon>

        <ActionIcon
          variant='subtle'
          size='sm'
          p={4}
          disabled={!canRun}
          onClick={() => {
            if (!canRun) return
            runCode()
          }}
        >
          <IHubIconPlay stroke={1} />
        </ActionIcon>
      </Group>
    </div>
  )
}
