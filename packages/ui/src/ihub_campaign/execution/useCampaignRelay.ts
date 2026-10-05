'use client'

import { useEffect, useRef } from 'react'

import { isCampaignRelayReadyMessage } from './actions'
import {
  createCampaignRelay,
  createCampaignRelayUnmountCleanup,
  type CampaignRelay,
} from './campaignRelay'
import { parseCampaignRelayPayload } from './events'

/** Owns one relay transport for the lifetime of a mounted campaign editor. */
export function useCampaignRelay(): CampaignRelay {
  const relayRef = useRef<CampaignRelay | null>(null)
  if (!relayRef.current) {
    relayRef.current = createCampaignRelay({
      createSocket: (url) => new WebSocket(url),
      parsePayload: parseCampaignRelayPayload,
      isReadyMessage: isCampaignRelayReadyMessage,
    })
  }
  const relay = relayRef.current

  useEffect(() => createCampaignRelayUnmountCleanup(relay), [relay])

  return relay
}
