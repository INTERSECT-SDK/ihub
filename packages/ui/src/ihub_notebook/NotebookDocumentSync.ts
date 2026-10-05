type NotebookDocumentPublishDecisionInput = {
  hasPublishedHydratedNotebook: boolean
  isHydratedNotebookSnapshot: boolean
}

/**
 * Resolves whether Notebook context should publish document content and whether
 * that publish represents a user edit. Provider defaults before hydration are
 * skipped; the loaded notebook snapshot is mirrored as clean.
 */
export function getNotebookDocumentPublishDecision({
  hasPublishedHydratedNotebook,
  isHydratedNotebookSnapshot,
}: NotebookDocumentPublishDecisionInput): {
  shouldPublish: boolean
  dirty: boolean
} {
  if (!hasPublishedHydratedNotebook) {
    return {
      shouldPublish: isHydratedNotebookSnapshot,
      dirty: false,
    }
  }

  return {
    shouldPublish: true,
    dirty: true,
  }
}
