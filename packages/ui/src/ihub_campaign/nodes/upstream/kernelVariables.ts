import type { VariableItem } from '@ihub/utils/types/types'

/** Converts kernel variable maps into selectable upstream items. */
export function kernelVariablesToVariableItems(
  variables: Record<string, unknown>,
): VariableItem[] {
  return Object.entries(variables).map(([varName, varType]) => ({
    title: varName,
    type: String(varType),
    path: varName,
  }))
}
