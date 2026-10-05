'use client'

import {
  createContext,
  useContext,
  useState,
  type PropsWithChildren,
} from 'react'

import {
  createCodeNodeConnectionRegistry,
  type CodeNodeConnectionRegistry,
} from './codeNodeConnectionRegistry'

const CodeNodeConnectionRegistryContext =
  createContext<CodeNodeConnectionRegistry | null>(null)

/** Provides one live code-node connection registry per campaign editor. */
export function CodeNodeConnectionRegistryProvider({
  children,
}: PropsWithChildren) {
  const [registry] = useState(() => createCodeNodeConnectionRegistry())

  return (
    <CodeNodeConnectionRegistryContext.Provider value={registry}>
      {children}
    </CodeNodeConnectionRegistryContext.Provider>
  )
}

/** Returns the registry associated with the currently mounted campaign. */
export function useCodeNodeConnectionRegistry(): CodeNodeConnectionRegistry {
  const registry = useContext(CodeNodeConnectionRegistryContext)
  if (!registry) {
    throw new Error(
      'useCodeNodeConnectionRegistry must be used within CodeNodeConnectionRegistryProvider',
    )
  }
  return registry
}
