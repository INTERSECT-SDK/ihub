import { useEffect } from 'react'

type ActivityCallback = ((active: boolean) => void) | undefined

export function hasCampaignDocumentActivity(
  isStarting: boolean,
  _isExecuting: boolean,
  isStopping: boolean,
): boolean {
  return isStarting || isStopping
}

export function reportCampaignDocumentActivity(
  callback: ActivityCallback,
  active: boolean,
): void {
  callback?.(active)
}

export function createCampaignDocumentActivityCleanup(
  callback: ActivityCallback,
): () => void {
  return () => callback?.(false)
}

/** Reports document-sensitive run transitions and clears them on unmount. */
export function useCampaignDocumentActivity(
  callback: ActivityCallback,
  isStarting: boolean,
  isExecuting: boolean,
  isStopping: boolean,
): void {
  const active = hasCampaignDocumentActivity(
    isStarting,
    isExecuting,
    isStopping,
  )

  useEffect(() => {
    reportCampaignDocumentActivity(callback, active)
  }, [active, callback])

  useEffect(() => createCampaignDocumentActivityCleanup(callback), [callback])
}
