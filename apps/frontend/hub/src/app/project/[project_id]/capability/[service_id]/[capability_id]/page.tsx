'use client'

import {
  Alert,
  Anchor,
  Badge,
  Card,
  Group,
  Loader,
  Stack,
  Text,
  Title,
  Tooltip,
} from '@mantine/core'
import { IHubIconInfoCircle } from '@ihub/utils/icons'
import { IconAlertCircle } from '@tabler/icons-react'
import { useParams } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import classes from './page.module.css'
import { formatLifecycleTimestamp } from './lifecycle-health.ts'

const SUPPORT_EMAIL = 'ihub-support@ornl.gov'
const CONTACT_PLACEHOLDER_NAME = 'TBD (contact info coming soon)'
const LIFECYCLE_HEALTH_TOOLTIP =
  'Lifecycle message last received/updated is when iHub received or refreshed the message in its database. Capability last processed successfully is the timestamp from the latest capability message that iHub processed successfully. These times may differ; an Error means the latest advertisement could not be processed.'

type CapabilityRecord = {
  id: number
  name: string
  service_id: number
  endpoints_schema?: Record<string, unknown> | null
  last_lifecycle_message: string | null
  lifecycle_last_updated: string | null
  lifecycle_error: string | null
  lifecycle_error_at: string | null
}

type ServiceRecord = {
  id: number
  name: string
  organization: string
  facility: string
  system: string
  subsystem: string
}

type CapabilityDetails = {
  name: string
  description: string
  contactName: string
  contactEmail: string
  serviceHierarchy: string
  lifecycleLastUpdated: string | null
  lastLifecycleMessage: string | null
  lifecycleError: string | null
  lifecycleErrorAt: string | null
}

const CAPABILITY_EVENT_DEBOUNCE_MS = 750

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function readStringField(
  source: Record<string, unknown> | null | undefined,
  keys: string[],
): string | null {
  if (!source) {
    return null
  }

  for (const key of keys) {
    const found = normalizeString(source[key])
    if (found) {
      return found
    }
  }

  return null
}

function extractDescription(
  schema: Record<string, unknown> | null | undefined,
) {
  const schemaDescription = readStringField(schema, ['description'])
  if (schemaDescription) {
    return schemaDescription
  }

  const groups = [schema?.channels, schema?.endpoints] as Array<
    Record<string, unknown> | undefined
  >

  for (const group of groups) {
    if (!group || typeof group !== 'object') {
      continue
    }

    for (const value of Object.values(group)) {
      if (!value || typeof value !== 'object') {
        continue
      }

      const channel = value as Record<string, unknown>
      const channelDescription = readStringField(channel, ['description'])
      if (channelDescription) {
        return channelDescription
      }

      const publish = channel.publish
      if (publish && typeof publish === 'object') {
        const publishDescription = readStringField(
          publish as Record<string, unknown>,
          ['description'],
        )
        if (publishDescription) {
          return publishDescription
        }
      }

      const subscribe = channel.subscribe
      if (subscribe && typeof subscribe === 'object') {
        const subscribeDescription = readStringField(
          subscribe as Record<string, unknown>,
          ['description'],
        )
        if (subscribeDescription) {
          return subscribeDescription
        }
      }
    }
  }

  return 'No description is currently available for this capability.'
}

function buildServiceHierarchy(service: ServiceRecord): string {
  return [
    service.organization,
    service.facility,
    service.system,
    service.subsystem,
    service.name,
  ]
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join('.')
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  const raw = await response.text()

  if (!response.ok) {
    throw new Error(`Request failed for ${url}: ${response.status}`)
  }

  if (!raw) {
    throw new Error(`No response body from ${url}`)
  }

  return JSON.parse(raw) as T
}

export default function CapabilityDetailsPage() {
  const params = useParams()
  const serviceId = useMemo(
    () => Number(params.service_id),
    [params.service_id],
  )
  const capabilityName = useMemo(
    () => normalizeString(params.capability_id),
    [params.capability_id],
  )

  const [details, setDetails] = useState<CapabilityDetails | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const headerCapabilityName = details?.name ?? capabilityName ?? 'Capability'

  useEffect(() => {
    if (Number.isNaN(serviceId) || !capabilityName) {
      setError('Invalid capability path.')
      setLoading(false)
      return
    }

    let isMounted = true
    let refreshInFlight = false
    let refreshQueued = false
    let refreshTimeoutId: number | undefined
    let streamErrorLogged = false

    const loadCapabilityDetails = async (background = false) => {
      if (refreshInFlight) {
        refreshQueued = true
        return
      }

      refreshInFlight = true

      try {
        if (!background) {
          setLoading(true)
        }
        if (isMounted && !background) {
          setError(null)
        }

        const [service, capabilities] = await Promise.all([
          fetchJson<ServiceRecord>(`/api/v1/services/service/${serviceId}`),
          fetchJson<CapabilityRecord[]>(
            `/api/v1/capabilities?service_id=${serviceId}`,
          ),
        ])

        const capability = capabilities.find(
          (item) => item.name.toLowerCase() === capabilityName.toLowerCase(),
        )

        if (!capability) {
          throw new Error('Capability was not found for this service.')
        }

        const capabilityMeta =
          capability.endpoints_schema &&
          typeof capability.endpoints_schema === 'object'
            ? capability.endpoints_schema
            : null

        const contactName =
          readStringField(capabilityMeta, [
            'contact_name',
            'owner_name',
            'maintainer_name',
          ]) ?? CONTACT_PLACEHOLDER_NAME
        const contactEmail =
          readStringField(capabilityMeta, [
            'contact_email',
            'owner_email',
            'maintainer_email',
          ]) ?? SUPPORT_EMAIL

        if (isMounted) {
          setDetails({
            name: capability.name,
            description: extractDescription(capabilityMeta),
            contactName,
            contactEmail,
            serviceHierarchy: buildServiceHierarchy(service),
            lifecycleLastUpdated: capability.lifecycle_last_updated,
            lastLifecycleMessage: capability.last_lifecycle_message,
            lifecycleError: capability.lifecycle_error,
            lifecycleErrorAt: capability.lifecycle_error_at,
          })
          setError(null)
        }
      } catch (loadError) {
        if (isMounted) {
          if (background) {
            console.warn(
              'Unable to refresh capability details; keeping the cached profile.',
              loadError,
            )
          } else if (loadError instanceof Error) {
            setError(loadError.message)
          } else {
            setError('Failed to load capability details.')
          }
        }
      } finally {
        refreshInFlight = false
        if (isMounted) {
          setLoading(false)
        }
        if (isMounted && refreshQueued) {
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
        void loadCapabilityDetails(true)
      }, CAPABILITY_EVENT_DEBOUNCE_MS)
    }

    void loadCapabilityDetails()

    const eventSource = new EventSource('/api/v1/messages/stream')
    eventSource.onmessage = scheduleRefresh
    eventSource.onerror = () => {
      if (!streamErrorLogged) {
        streamErrorLogged = true
        console.warn(
          'Capability lifecycle stream disconnected; updates will resume when the stream reconnects.',
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
  }, [capabilityName, serviceId])

  return (
    <div className={classes.page}>
      <div className={classes.topBarOuter}>
        <div className={classes.topBarInner}>
          <div />
          <Badge variant='light'>{headerCapabilityName}</Badge>
        </div>
      </div>

      {loading ? (
        <Group justify='center' pt='xl'>
          <Loader />
        </Group>
      ) : error ? (
        <Stack p='xl' maw={760}>
          <Alert
            icon={<IconAlertCircle size={16} />}
            color='red'
            title='Unable to load capability'
          >
            {error}
          </Alert>
        </Stack>
      ) : !details ? (
        <Stack p='xl' maw={760}>
          <Alert
            icon={<IconAlertCircle size={16} />}
            color='red'
            title='Capability unavailable'
          >
            Capability details are unavailable.
          </Alert>
        </Stack>
      ) : (
        <Stack p='xl' maw={760}>
          <Group justify='space-between' align='flex-start'>
            <Stack gap={0}>
              <Title order={2}>{details.name}</Title>
              <Text c='dimmed' size='sm'>
                Capability overview
              </Text>
            </Stack>
            <Badge variant='light'>Capability</Badge>
          </Group>

          <Card withBorder radius='md' p='lg'>
            <Text fw={700} mb='xs'>
              Description
            </Text>
            <Text size='sm'>{details.description}</Text>
          </Card>

          <Card withBorder radius='md' p='lg'>
            <Text fw={700} mb='xs'>
              Person in charge
            </Text>
            <Text size='sm'>{details.contactName}</Text>
            <Anchor href={`mailto:${details.contactEmail}`} size='sm'>
              {details.contactEmail}
            </Anchor>
          </Card>

          <Card withBorder radius='md' p='lg'>
            <Text fw={700} mb='xs'>
              Service
            </Text>
            <Text size='sm'>{details.serviceHierarchy}</Text>
          </Card>

          <Card withBorder radius='md' p='lg'>
            <Group gap={6} mb='xs'>
              <Text fw={700}>Lifecycle health</Text>
              <Tooltip
                label={LIFECYCLE_HEALTH_TOOLTIP}
                events={{ hover: true, focus: true, touch: false }}
                multiline
                w={300}
              >
                <span
                  role='img'
                  tabIndex={0}
                  aria-label='About lifecycle health'
                  style={{
                    alignItems: 'center',
                    color: 'var(--mantine-color-dimmed)',
                    cursor: 'help',
                    display: 'inline-flex',
                  }}
                >
                  <IHubIconInfoCircle aria-hidden size={15} />
                </span>
              </Tooltip>
            </Group>
            <Stack gap='xs'>
              <div>
                <Text size='sm' fw={600}>
                  Lifecycle message last received/updated
                </Text>
                <Text size='sm'>
                  {formatLifecycleTimestamp(details.lifecycleLastUpdated)}
                </Text>
              </div>
              <div>
                <Text size='sm' fw={600}>
                  Capability last processed successfully
                </Text>
                <Text size='sm'>
                  {formatLifecycleTimestamp(details.lastLifecycleMessage)}
                </Text>
              </div>
              {details.lifecycleError && (
                <Alert
                  icon={<IconAlertCircle size={16} />}
                  color='red'
                  title='Lifecycle ingest error'
                >
                  <Text size='sm'>{details.lifecycleError}</Text>
                  <Text size='xs' mt='xs'>
                    Occurred:{' '}
                    {formatLifecycleTimestamp(details.lifecycleErrorAt)}
                  </Text>
                </Alert>
              )}
            </Stack>
          </Card>
        </Stack>
      )}
    </div>
  )
}
