'use client'

/**
 * Provides paths to campaign files whose embedded document identities have
 * active runs, polling the campaign service and Jupyter contents API as needed.
 */

import { useMemo, useRef } from 'react'
import useSWR from 'swr'
import { useAtomValue } from 'jotai'

import { jupyterServersAtom } from '@/atoms/global.ts'
import { buildJupyterContentsUrl } from '@/app/project/project-file-path.ts'
import {
  fetchActiveCampaignRuns,
  type TrackedCampaignRun,
} from '@/components/SideNavbar/active-experiments.ts'
import {
  isCampaignFile,
  resolveActiveCampaignFilePaths,
  type CampaignFileCandidate,
  type CampaignIdentityCache,
} from '@/components/SideNavbar/project-file-active-campaigns.ts'

const ACTIVE_CAMPAIGN_REFRESH_INTERVAL = 5000

async function fetchCampaignDocument(
  file: CampaignFileCandidate,
  serverUrl: string,
  serverToken: string,
): Promise<unknown> {
  const response = await fetch(buildJupyterContentsUrl(serverUrl, file.path), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${serverToken}`,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
    },
  })
  if (!response.ok) {
    throw new Error(`Unable to read campaign file ${file.path}`)
  }

  const model: unknown = await response.json()
  return model && typeof model === 'object' && 'content' in model
    ? model.content
    : null
}

export function useActiveCampaignFiles(
  files: readonly CampaignFileCandidate[],
): readonly string[] {
  const server = useAtomValue(jupyterServersAtom)[0]
  const identityCacheRef = useRef<CampaignIdentityCache>(new Map())
  const campaignFiles = useMemo(() => files.filter(isCampaignFile), [files])
  const fileSignature = JSON.stringify(
    campaignFiles.map((file) => [file.path, file.last_modified ?? '']),
  )
  const canResolve = !!server && campaignFiles.length > 0
  const {
    data: activeCampaignRuns,
    error: activeCampaignRunsError,
    isLoading: activeCampaignRunsLoading,
  } = useSWR<TrackedCampaignRun[]>(
    canResolve ? 'active-campaign-runs' : null,
    () => fetchActiveCampaignRuns(),
    {
      refreshInterval: ACTIVE_CAMPAIGN_REFRESH_INTERVAL,
      revalidateOnFocus: true,
    },
  )
  const resolvedActiveCampaignRuns = activeCampaignRuns ?? []
  const activeCampaignSignature = JSON.stringify(
    resolvedActiveCampaignRuns.map((run) => run.campaign_id).sort(),
  )
  const { data: activeCampaignFilePaths } = useSWR<string[]>(
    !canResolve ||
      activeCampaignRunsLoading ||
      activeCampaignRunsError ||
      !activeCampaignRuns
      ? null
      : [
          'active-campaign-file-paths',
          server.url,
          fileSignature,
          activeCampaignSignature,
        ],
    () =>
      resolveActiveCampaignFilePaths(
        campaignFiles,
        resolvedActiveCampaignRuns,
        (file) => fetchCampaignDocument(file, server.url, server.token),
        identityCacheRef.current,
      ),
    {
      refreshInterval: ACTIVE_CAMPAIGN_REFRESH_INTERVAL,
      revalidateOnFocus: true,
    },
  )

  return activeCampaignFilePaths ?? []
}
