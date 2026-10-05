import type { CapabilityInputSourceMode } from '../nodes/capability/inputSource'

export type CapabilityInputSourceOverrideKey = {
  provenanceKey: string
  nodeId: string
  inputPath: string
}

export type CapabilityInputSourceOverrideStore = {
  getOverride: (
    key: CapabilityInputSourceOverrideKey,
  ) => CapabilityInputSourceMode | null
  subscribe: (
    key: CapabilityInputSourceOverrideKey,
    listener: () => void,
  ) => () => void
  setOverride: (
    key: CapabilityInputSourceOverrideKey,
    value: CapabilityInputSourceMode,
  ) => void
  dispose: () => void
}

function serializeKey({
  provenanceKey,
  nodeId,
  inputPath,
}: CapabilityInputSourceOverrideKey): string {
  return JSON.stringify([provenanceKey, nodeId, inputPath])
}

/** Creates one transient source-selection store for a mounted Campaign editor. */
export function createCapabilityInputSourceOverrideStore(): CapabilityInputSourceOverrideStore {
  const overrides = new Map<string, CapabilityInputSourceMode>()
  const listeners = new Map<string, Set<() => void>>()

  return {
    getOverride: (key) => overrides.get(serializeKey(key)) ?? null,
    subscribe: (key, listener) => {
      const serializedKey = serializeKey(key)
      const keyListeners = listeners.get(serializedKey) ?? new Set<() => void>()
      keyListeners.add(listener)
      listeners.set(serializedKey, keyListeners)
      return () => {
        keyListeners.delete(listener)
        if (keyListeners.size === 0) listeners.delete(serializedKey)
      }
    },
    setOverride: (key, value) => {
      const serializedKey = serializeKey(key)
      if (overrides.get(serializedKey) === value) return
      overrides.set(serializedKey, value)
      listeners.get(serializedKey)?.forEach((listener) => listener())
    },
    dispose: () => {
      if (overrides.size === 0) return
      overrides.clear()
      listeners.forEach((keyListeners) => {
        keyListeners.forEach((listener) => listener())
      })
    },
  }
}
