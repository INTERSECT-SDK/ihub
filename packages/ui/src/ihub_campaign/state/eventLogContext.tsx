'use client'

import { createContext, useContext, type ReactNode } from 'react'

import type { EventLogRefreshSignals } from '../execution/eventLogs'

export type CampaignEventLogContextValue = {
  runId: string | null
  runIsLoading: boolean
  runError: string | null
  retryRunLookup: () => void
  refreshSignals: EventLogRefreshSignals
}

const CampaignEventLogContext = createContext<CampaignEventLogContextValue>({
  runId: null,
  runIsLoading: false,
  runError: null,
  retryRunLookup: () => undefined,
  refreshSignals: {},
})

/** Shares the log run and persistence refresh signal with campaign nodes. */
export function CampaignEventLogProvider({
  children,
  value,
}: {
  children: ReactNode
  value: CampaignEventLogContextValue
}) {
  return (
    <CampaignEventLogContext.Provider value={value}>
      {children}
    </CampaignEventLogContext.Provider>
  )
}

/** Reads the persisted-event log selection for the mounted campaign editor. */
export function useCampaignEventLog(): CampaignEventLogContextValue {
  return useContext(CampaignEventLogContext)
}
