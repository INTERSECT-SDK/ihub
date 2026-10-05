import type { Broker, Capability } from '@/types.ts'

export type LauncherService = {
  id: number
  broker_id: number | null
}

export type LauncherRegistry = {
  services: LauncherService[]
  brokers: Broker[]
  capabilities: Capability[]
}

type LauncherRegistryResponse = Pick<Response, 'ok' | 'status' | 'text'>

export type LauncherRegistryFetch = (
  url: string,
  init?: Pick<RequestInit, 'signal'>,
) => Promise<LauncherRegistryResponse>

type LoadLauncherRegistryOptions = {
  signal?: AbortSignal
  fetcher?: LauncherRegistryFetch
}

const REGISTRY_PAGE_SIZE = 100

async function fetchJson<T>(
  url: string,
  fetcher: LauncherRegistryFetch,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetcher(url, { signal })
  const raw = await response.text()

  if (!response.ok) {
    throw new Error(`Request failed for ${url}: ${response.status}`)
  }

  if (!raw) {
    return [] as T
  }

  try {
    return JSON.parse(raw) as T
  } catch (error) {
    throw new Error(`Expected JSON response from ${url}`, { cause: error })
  }
}

async function fetchAllRegistryPages<T>(
  resource: string,
  fetcher: LauncherRegistryFetch,
  signal?: AbortSignal,
): Promise<T[]> {
  const records: T[] = []
  let offset = 0

  while (true) {
    const page = await fetchJson<T[]>(
      `/api/v1/${resource}?offset=${offset}&limit=${REGISTRY_PAGE_SIZE}`,
      fetcher,
      signal,
    )

    records.push(...page)

    if (page.length < REGISTRY_PAGE_SIZE) {
      return records
    }

    offset += REGISTRY_PAGE_SIZE
  }
}

/** Loads the complete registry used to classify Launcher capabilities. */
export async function loadLauncherRegistry({
  signal,
  fetcher = fetch,
}: LoadLauncherRegistryOptions = {}): Promise<LauncherRegistry> {
  const [services, brokers, capabilities] = await Promise.all([
    fetchAllRegistryPages<LauncherService>('services', fetcher, signal),
    fetchAllRegistryPages<Broker>('brokers', fetcher, signal),
    fetchAllRegistryPages<Capability>('capabilities', fetcher, signal),
  ])

  return { services, brokers, capabilities }
}
