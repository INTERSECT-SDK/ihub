import assert from 'node:assert/strict'
import test from 'node:test'

import type { ContentFile } from '@ihub/utils/types/types'

import {
  getNextProjectFileSortState,
  getProjectFileDisplayName,
  getProjectFileType,
  sortProjectFiles,
} from './project-file-sort.ts'

function file(
  name: string,
  created: string,
  type: ContentFile['type'] = 'file',
): ContentFile {
  return {
    name,
    path: `projects/project-id/${name}`,
    type,
    last_modified: created,
    created,
    writable: true,
  }
}

const files = [
  file('Campaign 10.icmp', '2026-07-28T12:00:00Z'),
  file('notes.txt', '2026-07-30T12:00:00Z'),
  file('Campaign 2.icmp', '2026-07-29T12:00:00Z'),
  file('Folder', '2026-07-27T12:00:00Z', 'directory'),
]

test('sorts project files naturally by name', () => {
  assert.deepEqual(
    sortProjectFiles(files, 'name', 'ascending').map(({ name }) => name),
    ['Campaign 2.icmp', 'Campaign 10.icmp', 'Folder', 'notes.txt'],
  )
})

test('toggles project file name sorting to descending', () => {
  assert.deepEqual(
    sortProjectFiles(files, 'name', 'descending').map(({ name }) => name),
    ['notes.txt', 'Folder', 'Campaign 10.icmp', 'Campaign 2.icmp'],
  )
})

test('sorts project files by type and then name', () => {
  assert.deepEqual(
    sortProjectFiles(files, 'type', 'ascending').map(({ name }) => name),
    ['Folder', 'Campaign 2.icmp', 'Campaign 10.icmp', 'notes.txt'],
  )
})

test('sorts project files by last modified time', () => {
  assert.deepEqual(
    sortProjectFiles(files, 'lastModified', 'descending').map(
      ({ name }) => name,
    ),
    ['notes.txt', 'Campaign 2.icmp', 'Campaign 10.icmp', 'Folder'],
  )
})

test('toggles the active header and defaults modified time to newest first', () => {
  assert.deepEqual(
    getNextProjectFileSortState(
      { sortBy: 'name', direction: 'ascending' },
      'name',
    ),
    { sortBy: 'name', direction: 'descending' },
  )
  assert.deepEqual(
    getNextProjectFileSortState(
      { sortBy: 'name', direction: 'descending' },
      'lastModified',
    ),
    { sortBy: 'lastModified', direction: 'descending' },
  )
  assert.deepEqual(
    getNextProjectFileSortState(
      { sortBy: 'lastModified', direction: 'descending' },
      'type',
    ),
    { sortBy: 'type', direction: 'ascending' },
  )
})

test('shows the full file name without its extension', () => {
  assert.equal(
    getProjectFileDisplayName(
      file('A much longer and friendlier campaign name.icmp', ''),
    ),
    'A much longer and friendlier campaign name',
  )
  assert.equal(
    getProjectFileDisplayName(file('Research Folder', '', 'directory')),
    'Research Folder',
  )
  assert.equal(getProjectFileType(file('Campaign.icmp', '')), 'ICMP')
  assert.equal(
    getProjectFileType(file('Research Folder', '', 'directory')),
    'Folder',
  )
  assert.equal(
    getProjectFileDisplayName(file('New%20Campaign%201.icmp', '')),
    'New Campaign 1',
  )
  assert.equal(
    getProjectFileDisplayName(file('literal%20name.txt', '')),
    'literal%20name',
  )
})
