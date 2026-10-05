'use client'

import { createContext, useContext, type ReactNode } from 'react'

import { canvasOwnsCodeNodeEditor } from './codeNodeEditorOwnership'

const CodeNodeEditorOwnershipContext = createContext<string | null>(null)

/** Identifies the Code node whose editor is currently owned by the inspector. */
export function CodeNodeEditorOwnershipProvider({
  inspectedNodeId,
  children,
}: {
  inspectedNodeId: string | null
  children: ReactNode
}) {
  return (
    <CodeNodeEditorOwnershipContext.Provider value={inspectedNodeId}>
      {children}
    </CodeNodeEditorOwnershipContext.Provider>
  )
}

/** Returns whether the canvas owns the interactive editor for a Code node. */
export function useCanvasCodeNodeEditorOwnership(nodeId: string): boolean {
  return canvasOwnsCodeNodeEditor(
    useContext(CodeNodeEditorOwnershipContext),
    nodeId,
  )
}
