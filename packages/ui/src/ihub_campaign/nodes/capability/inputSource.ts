export type CapabilityInputSourceMode = 'upstream' | 'custom'

export type CapabilityInputViewState = {
  inputSource: CapabilityInputSourceMode
  manualValue: string
  selectedValue: string | null
}

export type CapabilityManualValueOwnership =
  | { kind: 'editing'; displayValue: string }
  | { kind: 'persisting'; persistedValue: unknown }
  | null

export type CapabilityManualValueSynchronization = {
  manualValue: string
  ownership: CapabilityManualValueOwnership
}

/** Creates the remount boundary for input-local provenance-owned state. */
export function getCapabilityInputItemKey(
  provenanceKey: string,
  variableItemKey: string,
): string {
  return `${provenanceKey}:${variableItemKey}`
}

/**
 * Returns the segmented-control index for a value, falling back to the first
 * option when the value is unavailable or the options list is empty.
 */
export function getSegmentedControlActiveIndex(
  options: readonly { value: string }[],
  value: string,
): number {
  if (options.length === 0) return 0
  const activeIndex = options.findIndex((option) => option.value === value)
  return activeIndex === -1 ? 0 : activeIndex
}

/**
 * Resolves whether a capability input should use an upstream value or a custom
 * manual value based on current selections, user overrides, and availability.
 */
export function getCapabilityInputSourceMode({
  selectedUpstreamValue,
  manualInputValues = {},
  inputPath,
  hasUpstreamOptions,
  userInputSourceOverride = null,
}: {
  selectedUpstreamValue: string | null
  manualInputValues?: Record<string, unknown>
  inputPath: string
  hasUpstreamOptions: boolean
  userInputSourceOverride?: CapabilityInputSourceMode | null
}): CapabilityInputSourceMode {
  if (selectedUpstreamValue) return 'upstream'
  if (userInputSourceOverride) return userInputSourceOverride
  if (
    Object.prototype.hasOwnProperty.call(manualInputValues, inputPath) &&
    manualInputValues[inputPath] !== undefined
  ) {
    return 'custom'
  }
  return hasUpstreamOptions ? 'upstream' : 'custom'
}

/** Converts a persisted manual value or schema default into input display text. */
export function getManualValueDisplay(
  persistedValue: unknown,
  defaultValue: unknown,
): string {
  if (persistedValue != null) return String(persistedValue)
  if (defaultValue != null) return String(defaultValue)
  return ''
}

/**
 * Reconciles external values without replacing a local edit or echoing its own
 * persistence acknowledgement back into the field.
 */
export function synchronizeCapabilityManualValue({
  currentManualValue,
  displayedManualValue,
  persistedValue,
  ownership,
}: {
  currentManualValue: string
  displayedManualValue: string
  persistedValue: unknown
  ownership: CapabilityManualValueOwnership
}): CapabilityManualValueSynchronization {
  if (!ownership) {
    return { manualValue: displayedManualValue, ownership: null }
  }

  if (
    ownership.kind === 'persisting' &&
    Object.is(persistedValue, ownership.persistedValue)
  ) {
    return { manualValue: currentManualValue, ownership: null }
  }

  return { manualValue: currentManualValue, ownership }
}

/** Creates input-local state for a newly selected campaign or run view. */
export function createCapabilityInputViewState({
  persistedValue,
  defaultValue,
  selectedUpstreamValue,
  manualInputValues,
  inputPath,
  hasUpstreamOptions,
}: {
  persistedValue: unknown
  defaultValue: unknown
  selectedUpstreamValue: string | null
  manualInputValues: Record<string, unknown>
  inputPath: string
  hasUpstreamOptions: boolean
}): CapabilityInputViewState {
  return {
    inputSource: getCapabilityInputSourceMode({
      selectedUpstreamValue,
      manualInputValues,
      inputPath,
      hasUpstreamOptions,
    }),
    manualValue: getManualValueDisplay(persistedValue, defaultValue),
    selectedValue: selectedUpstreamValue,
  }
}

/** Uses snapshot-derived state in read-only views and local state when editing. */
export function getDisplayedCapabilityInputViewState(
  persistedState: CapabilityInputViewState,
  localState: CapabilityInputViewState,
  readOnly: boolean,
): CapabilityInputViewState {
  return readOnly ? persistedState : localState
}
