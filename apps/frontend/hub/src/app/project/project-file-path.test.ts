import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildJupyterContentsUrl,
  buildProjectEditorRoute,
  buildProjectFileRoute,
  encodePathSegments,
  getProjectFileNameForDisplay,
  getLogicalFilePath,
} from './project-file-path.ts'

test('encodes reserved characters, spaces, and Unicode segment-by-segment', () => {
  assert.equal(
    encodePathSegments('folder #1/query? 100%/文 件.json'),
    'folder%20%231/query%3F%20100%25/%E6%96%87%20%E4%BB%B6.json',
  )
})

test('builds the same canonical route from project and full-path inputs', () => {
  const expected =
    '/project/project-id/folder%20%231/query%3F%20100%25/%E6%96%87.json'

  assert.equal(
    buildProjectFileRoute('project-id', 'folder #1/query? 100%/文.json'),
    expected,
  )
  assert.equal(
    buildProjectEditorRoute('project-id/folder #1/query? 100%/文.json'),
    expected,
  )
})

test('reconstructs catch-all segments without decoding percent-like filenames', () => {
  const logicalPath = getLogicalFilePath([
    'nested%20folder',
    'literal%2523name.json',
  ])

  assert.equal(logicalPath, 'nested folder/literal%23name.json')
  assert.equal(
    buildJupyterContentsUrl(
      'http://localhost/ijupyterhub/user/example',
      `projects/project-id/${logicalPath}`,
    ),
    'http://localhost/ijupyterhub/user/example/api/contents/projects/project-id/nested%20folder/literal%2523name.json',
  )
})

test('preserves malformed route escapes and literal percent-like filenames', () => {
  assert.equal(getLogicalFilePath(['incomplete%2']), 'incomplete%2')
  assert.equal(
    getProjectFileNameForDisplay('literal%20name.json'),
    'literal%20name.json',
  )
})

test('renders names created by the legacy double-encoded launcher', () => {
  assert.equal(
    getProjectFileNameForDisplay('New%20Campaign%201.icmp'),
    'New Campaign 1.icmp',
  )
  assert.equal(
    getProjectFileNameForDisplay('New%20LLM%20Chat%202.ichat'),
    'New LLM Chat 2.ichat',
  )
})
