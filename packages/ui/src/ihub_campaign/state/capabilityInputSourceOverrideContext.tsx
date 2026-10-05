'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type PropsWithChildren,
} from 'react'

import type { CapabilityInputSourceMode } from '../nodes/capability/inputSource'
import {
  createCapabilityInputSourceOverrideStore,
  type CapabilityInputSourceOverrideKey,
  type CapabilityInputSourceOverrideStore,
} from './capabilityInputSourceOverrideStore'

const CapabilityInputSourceOverrideContext =
  createContext<CapabilityInputSourceOverrideStore | null>(null)

/** Provides editor-lifetime capability input source choices. */
export function CapabilityInputSourceOverrideProvider({
  children,
}: PropsWithChildren) {
  const [store] = useState(createCapabilityInputSourceOverrideStore)

  useEffect(() => () => store.dispose(), [store])

  return (
    <CapabilityInputSourceOverrideContext.Provider value={store}>
      {children}
    </CapabilityInputSourceOverrideContext.Provider>
  )
}

/** Selects and updates one capability input's transient source choice. */
export function useCapabilityInputSourceOverride(
  key: CapabilityInputSourceOverrideKey,
): readonly [
  CapabilityInputSourceMode | null,
  (value: CapabilityInputSourceMode) => void,
] {
  const store = useContext(CapabilityInputSourceOverrideContext)
  if (!store) {
    throw new Error(
      'useCapabilityInputSourceOverride must be used within CapabilityInputSourceOverrideProvider',
    )
  }

  const { provenanceKey, nodeId, inputPath } = key
  const getSnapshot = useCallback(
    () => store.getOverride({ provenanceKey, nodeId, inputPath }),
    [inputPath, nodeId, provenanceKey, store],
  )
  const subscribe = useCallback(
    (listener: () => void) =>
      store.subscribe({ provenanceKey, nodeId, inputPath }, listener),
    [inputPath, nodeId, provenanceKey, store],
  )
  const setOverride = useCallback(
    (value: CapabilityInputSourceMode) =>
      store.setOverride({ provenanceKey, nodeId, inputPath }, value),
    [inputPath, nodeId, provenanceKey, store],
  )
  const override = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  return [override, setOverride] as const
}
