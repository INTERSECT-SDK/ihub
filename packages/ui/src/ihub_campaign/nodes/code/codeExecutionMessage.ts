import type {
  JupyterCellOutput,
  JupyterOutputError,
  JupyterOutputExecResult,
  JupyterOutputStream,
} from '@ihub/utils/types/notebook'

export type CodeExecutionMessageUpdate = {
  executionCount?: number
  isComplete?: boolean
  output?: JupyterCellOutput
}

export type CodeExecutionMessageResult =
  | { kind: 'invalid-json' }
  | { kind: 'ignored' }
  | { kind: 'update'; update: CodeExecutionMessageUpdate }

type KernelExecutionMessage = {
  parent_header?: { msg_id?: unknown }
  header?: { msg_type?: unknown }
  content?: Record<string, unknown>
}

/** Reduces one websocket payload into the state changes for an active cell. */
export function reduceCodeExecutionMessage(
  eventData: unknown,
  executionId: string,
): CodeExecutionMessageResult {
  let parsedMessage: unknown
  try {
    parsedMessage = JSON.parse(String(eventData))
  } catch {
    return { kind: 'invalid-json' }
  }

  const message =
    parsedMessage && typeof parsedMessage === 'object'
      ? (parsedMessage as KernelExecutionMessage)
      : {}
  const content = message.content ?? {}

  if (message?.parent_header?.msg_id !== executionId) {
    return { kind: 'ignored' }
  }

  const update: CodeExecutionMessageUpdate = {}
  if (typeof content.execution_count === 'number') {
    update.executionCount = content.execution_count
  }

  switch (message?.header?.msg_type) {
    case 'stream':
      update.output = {
        output_type: 'stream',
        name: content.name,
        text: content.text,
      } as JupyterOutputStream
      break
    case 'execute_result':
      update.output = {
        output_type: 'execute_result',
        execution_count: content.execution_count,
        data: content.data,
        metadata: content.metadata,
      } as JupyterOutputExecResult
      break
    case 'execute_reply':
      update.isComplete = true
      break
    case 'error':
      update.output = {
        output_type: 'error',
        ename: content.ename,
        evalue: content.evalue,
        traceback: content.traceback,
      } as JupyterOutputError
      update.isComplete = true
      break
    case 'display_data':
      update.output = {
        output_type: 'display_data',
        data: content.data,
        metadata: content.metadata,
      } as JupyterCellOutput
      break
  }

  return { kind: 'update', update }
}
