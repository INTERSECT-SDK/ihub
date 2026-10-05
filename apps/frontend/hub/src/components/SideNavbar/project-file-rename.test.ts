import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

import type { ProjectFileRenamePublicationResult } from '../../app/project/project-file-coordination.ts'
import {
  buildRenamedProjectFile,
  buildProjectFileRenameTargetPath,
  buildProjectFileRenameUrl,
  canRenameProjectFile,
  getProjectFileRenameEditableName,
  getProjectFileRenameExtension,
  hasProjectFileRenameDuplicate,
  inspectFailedProjectFileRenameRefresh,
  initialProjectFileRenameState,
  projectFileRenameReducer,
  shouldReleasePreparedEditorAfterCommittedRename,
  validateProjectFileRename,
} from './project-file-rename.ts'

const navigatorSource = readFileSync(
  new URL('./ViewProjectFileNavigation.tsx', import.meta.url),
  'utf8',
)

test('successful rename keeps the validated campaign filename canonical', () => {
  const renamedFile = buildRenamedProjectFile(
    {
      name: 'original.icmp',
      path: 'projects/project-id/original.icmp',
      type: 'file',
      format: 'text',
      last_modified: '2026-07-22T12:00:00Z',
      created: '2026-07-22T11:00:00Z',
      writable: true,
    },
    {
      name: 'stale-response.icmp',
      path: 'projects/project-id/stale-response.icmp',
      last_modified: '2026-07-22T12:01:00Z',
    },
    'renamed δ.icmp',
    'projects/project-id/renamed δ.icmp',
  )

  assert.equal(renamedFile.name, 'renamed δ.icmp')
  assert.equal(renamedFile.path, 'projects/project-id/renamed δ.icmp')
  assert.equal(renamedFile.last_modified, '2026-07-22T12:01:00Z')
})

test('rename state starts, submits, fails, retries, and succeeds', () => {
  const editing = projectFileRenameReducer(initialProjectFileRenameState, {
    type: 'start',
    itemPath: 'projects/project-id/demo.json',
    originalName: 'demo.json',
  })
  assert.deepEqual(editing, {
    status: 'editing',
    itemPath: 'projects/project-id/demo.json',
    originalName: 'demo.json',
    value: 'demo',
    error: null,
  })

  const changed = projectFileRenameReducer(editing, {
    type: 'change',
    value: 'renamed',
  })
  const submitting = projectFileRenameReducer(changed, { type: 'submit' })
  assert.equal(submitting.status, 'submitting')

  const failed = projectFileRenameReducer(submitting, {
    type: 'fail',
    error: 'A file with this name already exists.',
  })
  assert.equal(failed.status, 'editing')
  assert.equal(failed.error, 'A file with this name already exists.')

  assert.deepEqual(
    projectFileRenameReducer(failed, { type: 'succeed' }),
    initialProjectFileRenameState,
  )
})

test('cancel returns an active rename to idle', () => {
  const editing = projectFileRenameReducer(initialProjectFileRenameState, {
    type: 'start',
    itemPath: 'projects/project-id/demo.json',
    originalName: 'demo.json',
  })

  assert.deepEqual(
    projectFileRenameReducer(editing, { type: 'cancel' }),
    initialProjectFileRenameState,
  )
})

test('submitting rename ignores replacement and cancellation actions', () => {
  const editing = projectFileRenameReducer(initialProjectFileRenameState, {
    type: 'start',
    itemPath: 'projects/project-id/demo.json',
    originalName: 'demo.json',
  })
  const submitting = projectFileRenameReducer(editing, { type: 'submit' })

  assert.equal(
    projectFileRenameReducer(submitting, {
      type: 'start',
      itemPath: 'projects/project-id/other.json',
      originalName: 'other.json',
    }),
    submitting,
  )
  assert.equal(
    projectFileRenameReducer(submitting, { type: 'cancel' }),
    submitting,
  )
})

test('navigator uses a synchronous single-flight guard and disables row rename actions', () => {
  assert.match(
    navigatorSource,
    /if \(\s*renameSubmissionRef\.current \|\|\s*renameState\.status !== 'editing'/,
  )
  assert.match(navigatorSource, /renameSubmissionRef\.current = true/)
  assert.match(
    navigatorSource,
    /renameActionsDisabled=\{renameState\.status === 'submitting'\}/,
  )
  assert.match(
    navigatorSource,
    /isDeleting \|\|\s*renameActionsDisabled \|\|\s*renameDisabledReason !== null/,
  )
})

test('navigator checks prepared editor freshness immediately before navigation', () => {
  assert.match(
    navigatorSource,
    /const preparedEditorFreshness = preparedEditor\s*\? preparedEditor\.isCurrent\(\)/,
  )
  assert.match(
    navigatorSource,
    /preparedEditorFreshness,\s*\},\s*\)\s*if \(renamedRoute && isCapturedRouteCurrent\(\)\)/,
  )
})

test('failed rename refresh distinguishes retryable and partial outcomes', () => {
  const sourcePath = 'projects/project-id/demo.json'
  const targetPath = 'projects/project-id/renamed.json'

  assert.deepEqual(
    inspectFailedProjectFileRenameRefresh(
      [{ path: sourcePath }],
      sourcePath,
      targetPath,
    ),
    { kind: 'source-present' },
  )
  assert.deepEqual(
    inspectFailedProjectFileRenameRefresh(
      [{ path: targetPath }],
      sourcePath,
      targetPath,
    ),
    { kind: 'target-present' },
  )
  assert.deepEqual(
    inspectFailedProjectFileRenameRefresh(
      [{ path: 'projects/project-id/other.json' }],
      sourcePath,
      targetPath,
    ),
    { kind: 'ambiguous' },
  )
  assert.deepEqual(
    inspectFailedProjectFileRenameRefresh(
      [{ path: sourcePath }, { path: targetPath }],
      sourcePath,
      targetPath,
    ),
    { kind: 'ambiguous' },
  )
  assert.deepEqual(
    inspectFailedProjectFileRenameRefresh(undefined, sourcePath, targetPath),
    { kind: 'unavailable' },
  )
})

test('navigator keeps source-present failures inline and reconciles effective partial renames', () => {
  assert.match(
    navigatorSource,
    /refreshState\.kind === 'target-present'[\s\S]*applyEffectiveRename\(/,
  )
  assert.match(
    navigatorSource,
    /dispatchRename\(\{ type: 'fail', error: renameError \}\)/,
  )
  assert.match(
    navigatorSource,
    /The rename result is unclear\. Refresh the project files before retrying\. The server reported:/,
  )
})

test('rejects exact duplicate targets before submitting a rename', () => {
  const targetPath = 'projects/project-id/renamed.json'

  assert.equal(
    hasProjectFileRenameDuplicate([{ path: targetPath }], targetPath),
    true,
  )
  assert.equal(
    hasProjectFileRenameDuplicate(
      [{ path: 'projects/project-id/other.json' }],
      targetPath,
    ),
    false,
  )
  assert.match(
    navigatorSource,
    /hasProjectFileRenameDuplicate\(contentList, validation\.targetPath\)/,
  )
})

test('navigator coordinates rename with exclusive locks and cross-context publication', () => {
  assert.match(
    navigatorSource,
    /projectFileCoordinator\.runExclusive\([\s\S]*buildProjectFileRenameUrl/,
  )
  assert.match(navigatorSource, /projectFileCoordinator\.publishRename\(/)
  assert.match(
    navigatorSource,
    /exclusiveResult\.status === 'blocked'[\s\S]*preparedEditor\?\.restore\(\)/,
  )
  assert.match(navigatorSource, /PROJECT_FILE_COORDINATION_UNSUPPORTED_ERROR/)
})

test('publication failure remains on the committed local rename path', () => {
  const committedRenameStart = navigatorSource.indexOf(
    'const applyEffectiveRename =',
  )
  const committedRenameEnd = navigatorSource.indexOf(
    'const reconcileFailedRename =',
  )
  const committedRenameSource = navigatorSource.slice(
    committedRenameStart,
    committedRenameEnd,
  )

  const publicationIndex = committedRenameSource.indexOf(
    'projectFileCoordinator.publishRename(completion)',
  )
  const fileListIndex = committedRenameSource.indexOf('setContentList')
  const selectionIndex = committedRenameSource.indexOf('setSelectedItem')
  const tabsIndex = committedRenameSource.indexOf('renameTabsForProjectFile')
  const routeIndex = committedRenameSource.indexOf(
    'router.replace(renamedRoute)',
  )
  const successIndex = committedRenameSource.indexOf(
    "dispatchRename({ type: 'succeed' })",
  )

  assert.ok(publicationIndex >= 0)
  assert.ok(fileListIndex > publicationIndex)
  assert.ok(selectionIndex > fileListIndex)
  assert.ok(tabsIndex > selectionIndex)
  assert.ok(routeIndex > tabsIndex)
  assert.ok(successIndex > routeIndex)
  assert.match(
    committedRenameSource,
    /was renamed, but browser synchronization was incomplete\./,
  )
  assert.match(
    committedRenameSource,
    /combineProjectFileRenameWarnings\(\s*warningText,\s*publicationWarning,/,
  )
})

test('committed renames never restore a prepared editor to the old path', () => {
  assert.match(
    navigatorSource,
    /exclusiveResult\.value === 'restore'[\s\S]*if \(!serverRenameCommitted\) \{\s*await preparedEditor\?\.restore\(\)/,
  )
  assert.match(
    navigatorSource,
    /if \(serverRenameCommitted\) \{[\s\S]*return\s*\}\s*await preparedEditor\?\.restore\(\)/,
  )
})

test('no-navigation fallback releases only after persistent publication', () => {
  const failedPersistence: ProjectFileRenamePublicationResult = {
    persistentMappingSucceeded: false,
    broadcastSucceeded: true,
    failedStages: ['persistent-mapping'],
  }
  const successfulPersistence: ProjectFileRenamePublicationResult = {
    persistentMappingSucceeded: true,
    broadcastSucceeded: false,
    failedStages: ['broadcast-message'],
  }

  assert.equal(
    shouldReleasePreparedEditorAfterCommittedRename(failedPersistence, false),
    false,
  )
  assert.equal(
    shouldReleasePreparedEditorAfterCommittedRename(
      successfulPersistence,
      false,
    ),
    true,
  )
  assert.equal(
    shouldReleasePreparedEditorAfterCommittedRename(
      successfulPersistence,
      true,
    ),
    false,
  )
  assert.match(
    navigatorSource,
    /The editor remains paused; reopen the renamed file from project navigation before continuing to edit\./,
  )
})

test('validates editable names while preserving the fixed extension', () => {
  const path = 'projects/project-id/nested/demo.JSON'

  assert.deepEqual(
    validateProjectFileRename(path, 'demo.JSON', '  renamed  '),
    {
      kind: 'valid',
      filename: 'renamed.JSON',
      targetPath: 'projects/project-id/nested/renamed.JSON',
    },
  )
  assert.deepEqual(validateProjectFileRename(path, 'demo.JSON', 'demo'), {
    kind: 'unchanged',
  })

  for (const value of ['', '   ', '.', '..', 'nested/demo', 'bad\\name']) {
    assert.equal(
      validateProjectFileRename(path, 'demo.JSON', value).kind,
      'invalid',
    )
  }

  assert.equal(
    validateProjectFileRename(
      path,
      'demo.JSON',
      `bad${String.fromCharCode(0)}name`,
    ).kind,
    'invalid',
  )
})

test('separates only the final extension from the editable file name', () => {
  assert.equal(
    getProjectFileRenameEditableName('report.final.json'),
    'report.final',
  )
  assert.equal(getProjectFileRenameExtension('report.final.json'), '.json')
  assert.equal(getProjectFileRenameEditableName('.env'), '.env')
  assert.equal(getProjectFileRenameExtension('.env'), '')
  assert.equal(getProjectFileRenameEditableName('README'), 'README')
  assert.equal(getProjectFileRenameExtension('README'), '')
})

test('builds nested targets and encodes proxy paths and query values', () => {
  assert.equal(
    buildProjectFileRenameTargetPath(
      'projects/project id/folder #1/文 件.json',
      'renamed ?.json',
    ),
    'projects/project id/folder #1/renamed ?.json',
  )

  assert.equal(
    buildProjectFileRenameUrl(
      'projects/project id/folder #1/文 件.json',
      'user+one@example.com',
      '/ijupyterhub/user/user@example.com/lab server',
    ),
    '/api/v1/contents/rename/projects/project%20id/folder%20%231/%E6%96%87%20%E4%BB%B6.json?jupyter_user=user%2Bone%40example.com&jupyter_server_url=%2Fijupyterhub%2Fuser%2Fuser%40example.com%2Flab+server',
  )
})

test('only editable writable non-directory items can be renamed', () => {
  assert.equal(
    canRenameProjectFile({ type: 'file', writable: true }, 'edit'),
    true,
  )
  assert.equal(
    canRenameProjectFile({ type: 'notebook', writable: true }, 'edit'),
    true,
  )
  assert.equal(
    canRenameProjectFile({ type: 'directory', writable: true }, 'edit'),
    false,
  )
  assert.equal(
    canRenameProjectFile({ type: 'file', writable: false }, 'edit'),
    false,
  )
  assert.equal(
    canRenameProjectFile({ type: 'file', writable: true }, 'view'),
    false,
  )
})
