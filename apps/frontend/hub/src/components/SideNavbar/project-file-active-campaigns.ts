/**
 * Campaign file detection and active run matching.
 *
 * Provides utilities to identify campaign files (`.icmp` extension), extract
 * campaign identities from persisted schemas, and resolve which visible
 * campaign files have active runs. Results are cached by file path and
 * modification time to minimize redundant reads.
 */
import type { TrackedCampaignRun } from './active-experiments.ts'
import {
  buildProjectFileRoute,
  getLogicalFilePath,
} from '../../app/project/project-file-path.ts'
import type { Tab } from '../../types.ts'

export type CampaignFileCandidate = {
  last_modified?: string
  name: string
  path: string
  type: string
}

export type CampaignIdentityCache = Map<string, string | null>

export type CampaignFileReader = (
  file: CampaignFileCandidate,
) => Promise<unknown>

/** Recognizes campaign files without making extension matching case-sensitive. */
export function isCampaignFile(file: CampaignFileCandidate): boolean {
  return file.type === 'file' && file.name.toLowerCase().endsWith('.icmp')
}

/**
 * Derives a campaign file candidate from a tab's canonical project route.
 * Optional tab metadata is deliberately ignored because restored and newly
 * created tabs do not always contain it.
 */
export function getCampaignFileFromTab(
  tab: Tab,
  projectId: string,
): CampaignFileCandidate | null {
  const projectFilePrefix = buildProjectFileRoute(projectId, '')
  const normalizedRoute = tab.path.startsWith('/') ? tab.path : `/${tab.path}`

  if (!normalizedRoute.startsWith(projectFilePrefix)) {
    return null
  }

  const encodedFilePath = normalizedRoute.slice(projectFilePrefix.length)
  if (!encodedFilePath) {
    return null
  }

  const filePath = getLogicalFilePath(encodedFilePath.split('/'))
  const candidate: CampaignFileCandidate = {
    name: filePath.split('/').at(-1) ?? filePath,
    path: `projects/${projectId}/${filePath}`,
    type: 'file',
  }

  return isCampaignFile(candidate) ? candidate : null
}

/** Extracts the identity from a canonical CampaignModel document. */
export function extractCampaignDocumentId(document: unknown): string | null {
  let candidate = document
  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate) as unknown
    } catch {
      return null
    }
  }

  if (!candidate || typeof candidate !== 'object') {
    return null
  }

  const record = candidate as Record<string, unknown>
  const campaignId = Array.isArray(record.task_groups) ? record.id : null
  return typeof campaignId === 'string' && campaignId.length > 0
    ? campaignId
    : null
}

function getCampaignIdentityCacheKey(file: CampaignFileCandidate): string {
  return `${file.path}\u0000${file.last_modified ?? ''}`
}

/**
 * Resolves visible campaign paths whose exact embedded identity has an active
 * run. Individual read failures are omitted so a later SWR refresh can retry.
 */
export async function resolveActiveCampaignFilePaths(
  files: readonly CampaignFileCandidate[],
  activeRuns: readonly TrackedCampaignRun[],
  readCampaignFile: CampaignFileReader,
  identityCache: CampaignIdentityCache = new Map(),
): Promise<string[]> {
  const campaignFiles = files.filter(isCampaignFile)
  const activeCampaignIds = new Set(
    activeRuns
      .filter((run) => run.status === 'ACTIVE')
      .map((run) => run.campaign_id),
  )
  if (campaignFiles.length === 0 || activeCampaignIds.size === 0) {
    return []
  }

  const visibleCacheKeys = new Set(
    campaignFiles.map(getCampaignIdentityCacheKey),
  )
  for (const cacheKey of identityCache.keys()) {
    if (!visibleCacheKeys.has(cacheKey)) {
      identityCache.delete(cacheKey)
    }
  }

  const resolvedFiles = await Promise.allSettled(
    campaignFiles.map(async (file) => {
      const cacheKey = getCampaignIdentityCacheKey(file)
      let campaignId = identityCache.get(cacheKey)
      if (campaignId === undefined) {
        campaignId = extractCampaignDocumentId(await readCampaignFile(file))
        identityCache.set(cacheKey, campaignId)
      }
      return activeCampaignIds.has(campaignId ?? '') ? file.path : null
    }),
  )

  return resolvedFiles.flatMap((result) =>
    result.status === 'fulfilled' && result.value ? [result.value] : [],
  )
}
