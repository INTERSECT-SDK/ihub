/**
 * Exposes the displayed campaign run identifier through React context and a
 * hook for components that need to associate results with that run.
 */

import { createContext, useContext } from 'react'

/**
 * React context containing the run whose results are displayed. This may be an
 * active run or the most recently completed successful run in this editor.
 */
export const CurrentRunIdContext = createContext<string | null>(null)

/**
 * Reads the campaign run identifier whose results are currently displayed.
 *
 * @returns The displayed run identifier, or `null` when no run is displayed.
 */
export function useCurrentRunId(): string | null {
  return useContext(CurrentRunIdContext)
}
