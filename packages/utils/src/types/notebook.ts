export type JupyterServerConfig = {
  id: string | number
  url: string
  token: string
  label: string
}

export type JupyterSession = {
  id: string
  kernel: JupyterKernel
  name: string
  notebook: {
    path: string
    name: string
  }
  path: string
  type: string
}

export type JupyterKernel = {
  connections: number
  execution_state: string
  id: string
  last_activity: string
  name: string
}

type JupyterServerKernelSessionNew = {
  server: JupyterServerConfig
  session: null
  new_kernel: true
}

type JupyterServerKernelSessionOld = {
  server: JupyterServerConfig
  session: JupyterSession
  new_kernel: false
}

export type JupyterServerKernelSession =
  | JupyterServerKernelSessionNew
  | JupyterServerKernelSessionOld

export type NewSessionRequestBody = {
  kernel: { name: 'python3' }
  name: string
  path: string
  type: 'notebook' | 'console' | 'terminal'
}

export type AvailableKernelList = {
  [key: string]: JupyterServerKernelSession
}

export type JupyterNotebookFile = {
  type: 'notebook'
  format: 'json'
  content: JupyterNotebookContent
  name: string
  [key: string]: any
}

export type JupyterNotebookContent = {
  cells: JupyterCell[]
  metadata: any
  nbformat: number
  nbformat_minor: number
}

export type JupyterCodeCell = {
  id: string
  cell_type: 'code'
  source: string
  outputs: JupyterCellOutput[]
  execution_count: number | null
  metadata: { [key: string]: any }
}

export type JupyterMarkdownCell = {
  id: string
  cell_type: 'markdown'
  source: string
  metadata: { [key: string]: any }
}

export type JupyterCell = JupyterCodeCell | JupyterMarkdownCell

export type JupyterOutputStream = {
  output_type: 'stream'
  name: 'stdout' | 'stderr'
  text: string
}

export type JupyterOutputExecResult = {
  output_type: 'execute_result'
  execution_count: number
  data: {
    [key: string]: string
  }
  metadata: {
    [key: string]: any
  }
}

export type JupyterOutputDisplayData = {
  output_type: 'display_data'
  data: {
    [key: string]: string
  }
  metadata: {
    [key: string]: any
  }
}

export type JupyterOutputError = {
  output_type: 'error'
  ename: string
  evalue: string
  traceback: string[]
}

export type JupyterOutputOther = {
  output_type: string
  [key: string]: any
}

export type JupyterCellOutput =
  | JupyterOutputDisplayData
  | JupyterOutputStream
  | JupyterOutputExecResult
  | JupyterOutputError
  | JupyterOutputOther

export type JupyterServerKernelConnection = {
  server: JupyterServerConfig
  session: JupyterSession
  connection: WebSocket
}
