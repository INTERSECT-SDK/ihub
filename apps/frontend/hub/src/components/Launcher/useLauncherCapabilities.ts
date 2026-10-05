import { useEffect, useState } from 'react'

import { lauchnerCapabilitiesList } from '@/atoms/defaults.ts'
import { IHubIconIntersect } from '@ihub/utils/icons'

import type { LauncherCapabilities, LauncherCapability } from '@/types.ts'
import {
  getCapabilityStatus,
  type LauncherCapabilityStatus,
} from './lifecycle-health.ts'
import { loadLauncherRegistry } from './launcher-registry.ts'

export type { LauncherCapabilityStatus } from './lifecycle-health.ts'

export type DiscoveredLauncherCapability = LauncherCapability & {
  status: LauncherCapabilityStatus
  capabilityName: string
  serviceId: number
  brokerId: number | null
  brokerLabel: string | null
  lifecycleError: string | null
}

const CAPABILITY_EVENT_DEBOUNCE_MS = 750

export function useLauncherCapabilities(): LauncherCapabilities[] {
  const [capabilitiesList, setCapabilitiesList] = useState(
    lauchnerCapabilitiesList,
  )

  useEffect(() => {
    let isMounted = true
    let refreshInFlight = false
    let refreshQueued = false
    let refreshTimeoutId: number | undefined
    let streamErrorLogged = false

    const loadCapabilities = async (signal?: AbortSignal) => {
      if (refreshInFlight) {
        refreshQueued = true
        return
      }

      refreshInFlight = true

      try {
        const { services, brokers, capabilities } = await loadLauncherRegistry({
          signal,
        })

        const brokerById = new Map(
          brokers.flatMap((broker) =>
            broker.id === undefined ? [] : [[broker.id, broker] as const],
          ),
        )
        const brokerIdByServiceId = new Map(
          services.map((service) => [service.id, service.broker_id]),
        )

        const discoveredCapabilities = capabilities.map((capability) => {
          const serviceId = Number(capability.service_id)
          const brokerId = brokerIdByServiceId.get(serviceId) ?? null
          const broker =
            brokerId === null ? undefined : brokerById.get(brokerId)

          return {
            label: capability.name,
            name: `${serviceId}-${capability.id}`,
            capabilityName: capability.name,
            serviceId,
            brokerId,
            brokerLabel: broker?.label ?? null,
            lifecycleError: capability.lifecycle_error,
            icon: IHubIconIntersect,
            view: null,
            status: getCapabilityStatus(capability, broker?.status),
          }
        }) as DiscoveredLauncherCapability[]

        if (isMounted) {
          setCapabilitiesList(
            lauchnerCapabilitiesList.concat({
              groupName: 'Browse capabilities',
              capabilities: discoveredCapabilities,
            }),
          )
        }
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          console.error('Failed to load launcher capabilities:', error)
        }
      } finally {
        refreshInFlight = false

        if (refreshQueued) {
          refreshQueued = false
          scheduleRefresh()
        }
      }
    }

    const scheduleRefresh = () => {
      if (refreshTimeoutId !== undefined) {
        return
      }

      refreshTimeoutId = window.setTimeout(() => {
        refreshTimeoutId = undefined
        void loadCapabilities()
      }, CAPABILITY_EVENT_DEBOUNCE_MS)
    }

    void loadCapabilities()

    const eventSource = new EventSource('/api/v1/messages/stream')
    eventSource.onmessage = scheduleRefresh

    eventSource.onerror = () => {
      if (!streamErrorLogged) {
        streamErrorLogged = true
        console.warn(
          'Launcher message stream disconnected; updates will resume when the stream reconnects.',
        )
      }
    }

    eventSource.onopen = () => {
      streamErrorLogged = false
    }

    return () => {
      isMounted = false
      if (refreshTimeoutId !== undefined) {
        window.clearTimeout(refreshTimeoutId)
      }
      eventSource.close()
    }
  }, [])

  return capabilitiesList
}
