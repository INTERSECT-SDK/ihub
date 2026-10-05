'use client'

import { createContext, useContext, type RefObject } from 'react'

type CampaignNodeRenderSettings =
  | { mode: 'canvas' }
  | {
      mode: 'inspector'
      headingRef: RefObject<HTMLHeadingElement | null>
      onBack?: () => void
      backLabel?: string
      onClose: () => void
    }

const CampaignNodeRenderContext = createContext<CampaignNodeRenderSettings>({
  mode: 'canvas',
})

export const CampaignNodeRenderProvider = CampaignNodeRenderContext.Provider

/** Identifies whether a task is rendering as a graph card or inspector body. */
export function useCampaignNodeRenderSettings() {
  return useContext(CampaignNodeRenderContext)
}
