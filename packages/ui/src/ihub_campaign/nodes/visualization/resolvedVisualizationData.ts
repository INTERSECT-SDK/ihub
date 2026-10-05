import type { NodeStatus } from '../../state/executionContext'

export type ResolvedVisualizationData = {
  runId: string | null
  data: Record<string, unknown>
  sourceIterations: Record<string, number>
}

/** Returns the iteration that produced the newest completed source output. */
export function getCompletedOutputIteration(
  status: NodeStatus,
  runCount: number,
): number | null {
  if (runCount < 1) return null
  if (status === 'complete') return runCount
  return Math.max(1, runCount - 1)
}

/**
 * Returns resolved visualization data only in the run context that produced it.
 * Run-independent literal and code-node previews use a `null` run identifier
 * and remain visible across campaign runs.
 *
 * @param resolution - Data and the persisted-output run used to resolve it.
 * @param currentRunId - Run whose results the editor is currently displaying.
 * @returns Current or run-independent data, otherwise an empty payload.
 */
export function getVisibleResolvedVisualizationData<
  TData extends Record<string, unknown>,
>(
  resolution: { runId: string | null; data: TData },
  currentRunId: string | null,
): TData {
  if (resolution.runId !== null && resolution.runId !== currentRunId) {
    return {} as TData
  }
  return resolution.data
}
