import type { CodeNode } from '@ihub/utils/types/campaign'

/** Primitive values that uniquely identify a code node's Jupyter connection. */
type CodeNodeConnectionTarget = {
  sessionId: string
  kernelId: string
  serverUrl: string
  serverToken: string
}

/** Selects only the values whose changes require a new Jupyter connection. */
export function selectCodeNodeConnectionTarget(
  data: CodeNode,
): CodeNodeConnectionTarget {
  return {
    sessionId: data.kernel.id,
    kernelId: data.kernel.kernel.id,
    serverUrl: data.server.url,
    serverToken: data.server.token,
  }
}
