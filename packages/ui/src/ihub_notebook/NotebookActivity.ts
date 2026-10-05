export interface NotebookExecutionActivityUpdate {
  executingCellIds: Set<string>
  didBecomeActive: boolean
  didBecomeIdle: boolean
  didChange: boolean
}

/** Aggregates per-cell execution state into notebook-level activity changes. */
export function updateNotebookExecutionActivity(
  currentExecutingCellIds: ReadonlySet<string>,
  cellId: string,
  active: boolean,
): NotebookExecutionActivityUpdate {
  const wasCellActive = currentExecutingCellIds.has(cellId)
  if (wasCellActive === active) {
    return {
      executingCellIds: new Set(currentExecutingCellIds),
      didBecomeActive: false,
      didBecomeIdle: false,
      didChange: false,
    }
  }

  const wasNotebookActive = currentExecutingCellIds.size > 0
  const executingCellIds = new Set(currentExecutingCellIds)
  if (active) {
    executingCellIds.add(cellId)
  } else {
    executingCellIds.delete(cellId)
  }

  return {
    executingCellIds,
    didBecomeActive: !wasNotebookActive && executingCellIds.size > 0,
    didBecomeIdle: wasNotebookActive && executingCellIds.size === 0,
    didChange: true,
  }
}
