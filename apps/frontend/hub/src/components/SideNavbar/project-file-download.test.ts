import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildProjectFileDownloadUrl,
  launchProjectFileDownload,
  stopProjectFileRowActionEvent,
  type ProjectFileDownloadDocument,
} from './project-file-download.ts'
import { buildRenamedProjectFile } from './project-file-rename.ts'

test('builds a segment-safe project file download URL', () => {
  assert.equal(
    buildProjectFileDownloadUrl(
      'projects/project 123/folder/name #1.json',
      'user+one@example.com',
      '/ijupyterhub/user/user%2Bone%40example.com/lab server',
    ),
    '/api/v1/contents/download/projects/project%20123/folder/name%20%231.json' +
      '?jupyter_user=user%2Bone%40example.com&' +
      'jupyter_server_url=%2Fijupyterhub%2Fuser%2Fuser%252Bone%2540example.com%2Flab+server',
  )
})

test('launches concurrent downloads with independent native browser anchors', () => {
  type FakeAnchor = {
    href: string
    download: string
    style: { display: string }
    clicked: boolean
    removed: boolean
    click: () => void
    remove: () => void
  }
  const anchors: FakeAnchor[] = []
  const appendedAnchors: FakeAnchor[] = []
  const downloadDocument = {
    createElement: () => {
      const anchor: FakeAnchor = {
        href: '',
        download: '',
        style: { display: '' },
        clicked: false,
        removed: false,
        click: () => {
          anchor.clicked = true
        },
        remove: () => {
          anchor.removed = true
        },
      }
      anchors.push(anchor)
      return anchor
    },
    body: {
      append: (anchor: FakeAnchor) => {
        appendedAnchors.push(anchor)
      },
    },
  }

  launchProjectFileDownload(
    '/api/v1/contents/download/first.bin',
    'first.bin',
    downloadDocument as unknown as ProjectFileDownloadDocument,
  )
  launchProjectFileDownload(
    '/api/v1/contents/download/second.bin',
    'second.bin',
    downloadDocument as unknown as ProjectFileDownloadDocument,
  )

  assert.equal(anchors.length, 2)
  assert.notEqual(anchors[0], anchors[1])
  assert.deepEqual(appendedAnchors, anchors)
  assert.deepEqual(
    anchors.map(({ href, download, style, clicked, removed }) => ({
      href,
      download,
      style,
      clicked,
      removed,
    })),
    [
      {
        href: '/api/v1/contents/download/first.bin',
        download: 'first.bin',
        style: { display: 'none' },
        clicked: true,
        removed: true,
      },
      {
        href: '/api/v1/contents/download/second.bin',
        download: 'second.bin',
        style: { display: 'none' },
        clicked: true,
        removed: true,
      },
    ],
  )
})

test('uses the canonical renamed campaign filename for download', () => {
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
    {},
    'renamed.icmp',
    'projects/project-id/renamed.icmp',
  )
  const anchor = {
    href: '',
    download: '',
    style: { display: '' },
    click: () => undefined,
    remove: () => undefined,
  }
  const downloadDocument = {
    createElement: () => anchor,
    body: { append: () => undefined },
  }

  launchProjectFileDownload(
    '/api/v1/contents/download/projects/project-id/renamed.icmp',
    renamedFile.name,
    downloadDocument as unknown as ProjectFileDownloadDocument,
  )

  assert.equal(anchor.download, 'renamed.icmp')
})

test('isolates project file row action events', () => {
  let propagationStops = 0

  stopProjectFileRowActionEvent({
    stopPropagation: () => {
      propagationStops += 1
    },
  })

  assert.equal(propagationStops, 1)
})
