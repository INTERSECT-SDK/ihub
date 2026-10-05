import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getNextProjectFileName,
  getProjectListingNames,
} from './project-file-name.ts'

test('starts launcher filenames at one', () => {
  assert.equal(
    getNextProjectFileName([], 'Campaign', 'icmp'),
    'New Campaign 1.icmp',
  )
})

test('increments the highest matching launcher filename', () => {
  assert.equal(
    getNextProjectFileName(
      [
        'New Campaign 1.icmp',
        'new campaign 3.ICMP',
        'New%20Campaign%204.icmp',
        'Unrelated.icmp',
        'New Campaign 20.txt',
      ],
      'Campaign',
      'icmp',
    ),
    'New Campaign 5.icmp',
  )
})

test('validates Jupyter project file listings', () => {
  assert.deepEqual(
    getProjectListingNames({
      content: [{ name: 'Campaign.icmp' }, { name: 'Notes.txt' }],
    }),
    ['Campaign.icmp', 'Notes.txt'],
  )
  assert.throws(
    () => getProjectListingNames({ content: [{ path: 'missing-name' }] }),
    /malformed/,
  )
})
