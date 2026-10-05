import assert from 'node:assert/strict'
import test from 'node:test'

import type { TrackedCampaignRun } from './active-experiments.ts'
import {
  extractCampaignDocumentId,
  getCampaignFileFromTab,
  isCampaignFile,
  resolveActiveCampaignFilePaths,
  type CampaignFileCandidate,
} from './project-file-active-campaigns.ts'
import type { Tab } from '../../types.ts'

function file(
  path: string,
  lastModified = '2026-08-11T12:00:00Z',
): CampaignFileCandidate {
  return {
    name: path.split('/').at(-1) ?? path,
    path,
    type: 'file',
    last_modified: lastModified,
  }
}

function activeRun(campaignId: string): TrackedCampaignRun {
  return {
    id: 1,
    user_email: 'signed-in@example.com',
    campaign_id: campaignId,
    run_id: `run-${campaignId}`,
    run_at: '2026-08-11T12:00:00Z',
    orchestrator_url: null,
    status: 'ACTIVE',
    ended_at: null,
    campaign_name: null,
    broker_id: null,
  }
}

function tab(path: string, name?: string): Tab {
  return {
    id: path,
    path,
    title: 'Campaign',
    ...(name ? { name } : {}),
  }
}

test('recognizes campaign extensions case-insensitively', () => {
  assert.equal(isCampaignFile(file('campaign.icmp')), true)
  assert.equal(isCampaignFile(file('campaign.ICMP')), true)
  assert.equal(isCampaignFile(file('campaign.icmp.json')), false)
  assert.equal(
    isCampaignFile({ ...file('folder.icmp'), type: 'directory' }),
    false,
  )
})

test('derives campaign files from canonical tab routes without metadata', () => {
  assert.deepEqual(
    getCampaignFileFromTab(
      tab('/project/project-one/New%20Campaign%201.icmp'),
      'project-one',
    ),
    {
      name: 'New Campaign 1.icmp',
      path: 'projects/project-one/New Campaign 1.icmp',
      type: 'file',
    },
  )
  assert.deepEqual(
    getCampaignFileFromTab(
      tab('project/project-one/nested%20folder/literal%23%25.icmp'),
      'project-one',
    ),
    {
      name: 'literal#%.icmp',
      path: 'projects/project-one/nested folder/literal#%.icmp',
      type: 'file',
    },
  )
})

test('detects restored campaign tabs independently of stale metadata', () => {
  assert.deepEqual(
    getCampaignFileFromTab(
      tab(
        '/project/project-one/restored.icmp',
        'projects/another-project/stale.txt',
      ),
      'project-one',
    ),
    {
      name: 'restored.icmp',
      path: 'projects/project-one/restored.icmp',
      type: 'file',
    },
  )
})

test('rejects other projects, project roots, and non-campaign files', () => {
  assert.equal(
    getCampaignFileFromTab(
      tab('/project/project-two/campaign.icmp'),
      'project-one',
    ),
    null,
  )
  assert.equal(
    getCampaignFileFromTab(tab('/project/project-one'), 'project-one'),
    null,
  )
  assert.equal(
    getCampaignFileFromTab(
      tab('/project/project-one/notes.txt'),
      'project-one',
    ),
    null,
  )
})

test('extracts only canonical CampaignModel identities', () => {
  assert.equal(
    extractCampaignDocumentId({ id: 'current-id', task_groups: [] }),
    'current-id',
  )
  assert.equal(extractCampaignDocumentId({ campaignId: 'legacy-id' }), null)
  assert.equal(
    extractCampaignDocumentId('{"campaignId":"serialized-id"}'),
    null,
  )
  assert.equal(extractCampaignDocumentId({ id: 123 }), null)
  assert.equal(extractCampaignDocumentId('{malformed'), null)
})

test('matches exact IDs and keeps duplicate filenames isolated by path', async () => {
  const files = [
    file('projects/one/shared.icmp'),
    file('projects/two/shared.icmp'),
  ]
  const documents = new Map([
    [files[0].path, { id: 'campaign-active', task_groups: [] }],
    [files[1].path, { id: 'campaign-active-suffix', task_groups: [] }],
  ])

  const paths = await resolveActiveCampaignFilePaths(
    files,
    [activeRun('campaign-active')],
    async (candidate) => documents.get(candidate.path),
  )

  assert.deepEqual([...paths], ['projects/one/shared.icmp'])
})

test('caches identities by path and modification time', async () => {
  const cache = new Map<string, string | null>()
  let reads = 0
  const read = async () => {
    reads += 1
    return { id: 'campaign-active', task_groups: [] }
  }
  const original = file('projects/one/campaign.icmp')

  await resolveActiveCampaignFilePaths(
    [original],
    [activeRun('campaign-active')],
    read,
    cache,
  )
  await resolveActiveCampaignFilePaths(
    [original],
    [activeRun('campaign-active')],
    read,
    cache,
  )
  await resolveActiveCampaignFilePaths(
    [file(original.path, '2026-08-11T12:01:00Z')],
    [activeRun('campaign-active')],
    read,
    cache,
  )

  assert.equal(reads, 2)
})

test('omits invalid files while retrying a partial campaign read failure', async () => {
  const cache = new Map<string, string | null>()
  const malformed = file('projects/one/malformed.icmp')
  const inactive = file('projects/one/inactive.icmp')
  const active = file('projects/one/active.icmp')
  const unreadable = file('projects/one/unreadable.icmp')
  const files = [
    malformed,
    inactive,
    active,
    unreadable,
    file('projects/one/notes.txt'),
  ]
  let unreadableAttempts = 0
  const read = async (candidate: CampaignFileCandidate) => {
    if (candidate.path === unreadable.path && unreadableAttempts++ === 0) {
      throw new Error('temporary read failure')
    }
    if (candidate.path === malformed.path) {
      return { campaignId: 123 }
    }
    return {
      id:
        candidate.path === inactive.path
          ? 'campaign-inactive'
          : 'campaign-active',
      task_groups: [],
    }
  }

  const firstPaths = await resolveActiveCampaignFilePaths(
    files,
    [activeRun('campaign-active')],
    read,
    cache,
  )
  const retriedPaths = await resolveActiveCampaignFilePaths(
    files,
    [activeRun('campaign-active')],
    read,
    cache,
  )

  assert.deepEqual(firstPaths, [active.path])
  assert.deepEqual(retriedPaths, [active.path, unreadable.path])
  assert.equal(unreadableAttempts, 2)
})
