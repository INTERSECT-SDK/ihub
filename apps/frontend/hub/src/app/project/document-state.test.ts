import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  applyDocumentContentUpdate,
  assertSuccessfulSaveResponse,
  buildDocumentKey,
  flushDocumentSaveBarrier,
  getActiveLoadedDocument,
  getDocumentSaveFailureMessage,
  getNormalizedFileExtension,
  markDocumentCleanAfterSave,
  normalizeJsonFileContent,
  normalizeHttpBaseUrl,
  normalizeTextFileContent,
  ownsLatestSaveCompletion,
  parseLoadedDocumentContent,
  preserveDirtyAfterFailedSave,
  savedLatestDocumentSnapshot,
  shouldAutosaveDocument,
  shouldAttemptAutomaticSave,
  DocumentSaveResponseError,
  type AutosaveFailure,
  type DocumentSaveAttempt,
  type LoadedDocument,
} from './document-state.ts'

const jupyterServer = {
  id: 'server-1',
  label: 'Server 1',
  url: 'localhost:8888/',
  token: 'token-1',
}

const clientPageSource = readFileSync(
  new URL('./[project_id]/[...file_path]/ClientPage.tsx', import.meta.url),
  'utf8',
)

test('document key differs when only the Jupyter server changes', () => {
  const firstKey = buildDocumentKey({
    projectId: 'project-1',
    filePath: 'campaign.icmp',
    jupyterServer,
    jupyterServerBaseUrl: normalizeHttpBaseUrl(jupyterServer.url),
  })
  const secondKey = buildDocumentKey({
    projectId: 'project-1',
    filePath: 'campaign.icmp',
    jupyterServer: {
      ...jupyterServer,
      id: 'server-2',
    },
    jupyterServerBaseUrl: normalizeHttpBaseUrl(jupyterServer.url),
  })
  const thirdKey = buildDocumentKey({
    projectId: 'project-1',
    filePath: 'campaign.icmp',
    jupyterServer: {
      ...jupyterServer,
      url: 'localhost:9999/',
    },
    jupyterServerBaseUrl: normalizeHttpBaseUrl('localhost:9999/'),
  })

  assert.notEqual(firstKey, secondKey)
  assert.notEqual(firstKey, thirdKey)
})

test('document key preserves numeric Jupyter server ids', () => {
  const key = buildDocumentKey({
    projectId: 'project-1',
    filePath: 'campaign.icmp',
    jupyterServer: {
      ...jupyterServer,
      id: 42,
    },
    jupyterServerBaseUrl: normalizeHttpBaseUrl(jupyterServer.url),
  })

  assert.equal(key, '42@http://localhost:8888::project-1/campaign.icmp')
})

test('stale loaded document is not active or autosave eligible for a new key', () => {
  const staleDocument: LoadedDocument = {
    key: 'server-1@http://localhost:8888::project-1/campaign.icmp',
    dirty: true,
    document: { content: { campaignName: 'Old' } },
  }
  const currentKey = 'server-2@http://localhost:9999::project-1/campaign.icmp'

  assert.equal(getActiveLoadedDocument(staleDocument, currentKey), undefined)
  assert.equal(
    shouldAutosaveDocument({
      loadedDocument: staleDocument,
      currentDocumentKey: currentKey,
      jupyterServer,
      jupyterServerBaseUrl: 'http://localhost:9999',
      activeLoadError: null,
    }),
    false,
  )
})

test('loaded or created document starts clean and is not autosave eligible', () => {
  const currentKey = 'server-1@http://localhost:8888::project-1/campaign.icmp'
  const loadedDocument: LoadedDocument = {
    key: currentKey,
    dirty: false,
    document: { content: { campaignName: 'Loaded' } },
  }

  assert.equal(
    shouldAutosaveDocument({
      loadedDocument,
      currentDocumentKey: currentKey,
      jupyterServer,
      jupyterServerBaseUrl: 'http://localhost:8888',
      activeLoadError: null,
    }),
    false,
  )
})

test('create conflicts never fall back to opening an existing document', () => {
  assert.match(
    clientPageSource,
    /A document with this name was created elsewhere\./,
  )
  assert.doesNotMatch(
    clientPageSource,
    /if \(createFileResponse\.status === 409\)[\s\S]*retryReadResponse/,
  )
})

test('clean content update preserves autosave ineligibility', () => {
  const currentKey = 'server-1@http://localhost:8888::project-1/campaign.icmp'
  const loadedDocument: LoadedDocument = {
    key: currentKey,
    dirty: false,
    document: { content: { campaignName: 'Loaded' } },
  }

  const updatedDocument = applyDocumentContentUpdate(
    loadedDocument,
    currentKey,
    { campaignName: 'Hydrated' },
    { dirty: false },
  )

  assert.equal(updatedDocument?.dirty, false)
  assert.equal(
    shouldAutosaveDocument({
      loadedDocument: updatedDocument,
      currentDocumentKey: currentKey,
      jupyterServer,
      jupyterServerBaseUrl: 'http://localhost:8888',
      activeLoadError: null,
    }),
    false,
  )
})

test('normal content update marks document autosave eligible', () => {
  const currentKey = 'server-1@http://localhost:8888::project-1/campaign.icmp'
  const loadedDocument: LoadedDocument = {
    key: currentKey,
    dirty: false,
    document: { content: { campaignName: 'Loaded' } },
  }

  const updatedDocument = applyDocumentContentUpdate(
    loadedDocument,
    currentKey,
    {
      campaignName: 'Edited',
    },
  )

  assert.equal(updatedDocument?.dirty, true)
  assert.equal(
    shouldAutosaveDocument({
      loadedDocument: updatedDocument,
      currentDocumentKey: currentKey,
      jupyterServer,
      jupyterServerBaseUrl: 'http://localhost:8888',
      activeLoadError: null,
    }),
    true,
  )
})

test('successful save clears dirty only for the saved document snapshot', () => {
  const currentKey = 'server-1@http://localhost:8888::project-1/campaign.icmp'
  const savedDocument: LoadedDocument = {
    key: currentKey,
    dirty: true,
    document: { content: { campaignName: 'Saved' } },
  }
  const laterDocument: LoadedDocument = {
    key: currentKey,
    dirty: true,
    document: { content: { campaignName: 'Edited Again' } },
  }

  assert.equal(
    markDocumentCleanAfterSave(savedDocument, savedDocument)?.dirty,
    false,
  )
  assert.equal(
    markDocumentCleanAfterSave(laterDocument, savedDocument)?.dirty,
    true,
  )
})

test('failed save responses reject with status and response body', async () => {
  await assert.rejects(
    assertSuccessfulSaveResponse(
      new Response('permission denied', {
        status: 403,
        statusText: 'Forbidden',
      }),
    ),
    /Failed to save document: 403 Forbidden permission denied/,
  )
})

test('successful save responses resolve', async () => {
  await assert.doesNotReject(
    assertSuccessfulSaveResponse(new Response(null, { status: 204 })),
  )
})

test('HTTP 413 save failures retain diagnostics and show a concise size error', async () => {
  let saveError: unknown
  try {
    await assertSuccessfulSaveResponse(
      new Response('<html>nginx request entity too large</html>', {
        status: 413,
        statusText: 'Request Entity Too Large',
      }),
    )
  } catch (error) {
    saveError = error
  }

  assert.ok(saveError instanceof DocumentSaveResponseError)
  assert.equal(saveError.status, 413)
  assert.match(saveError.message, /nginx request entity too large/)
  assert.equal(
    getDocumentSaveFailureMessage(saveError),
    'This document is too large to save. Reduce its size and retry.',
  )
})

test('automatic save attempts a failed snapshot only once until it changes', () => {
  const failedDocument: LoadedDocument = {
    key: 'server::project/chat.ichat',
    dirty: true,
    document: { content: { messages: ['large result'] } },
  }
  const failure: AutosaveFailure = {
    key: failedDocument.key,
    document: failedDocument.document,
    message: 'Changes not saved',
  }
  const editedDocument: LoadedDocument = {
    ...failedDocument,
    document: { content: { messages: ['large result', 'new edit'] } },
  }

  assert.equal(shouldAttemptAutomaticSave(failedDocument, failure), false)
  assert.equal(shouldAttemptAutomaticSave(editedDocument, failure), true)
})

test('save completion ownership rejects stale attempts and snapshots', () => {
  const firstDocument = { content: { messages: ['first'] } }
  const secondDocument = { content: { messages: ['second'] } }
  const firstAttempt: DocumentSaveAttempt = {
    id: 1,
    key: 'server::project/chat.ichat',
    document: firstDocument,
  }
  const secondAttempt: DocumentSaveAttempt = {
    id: 2,
    key: firstAttempt.key,
    document: secondDocument,
  }

  assert.equal(
    ownsLatestSaveCompletion({
      attempt: firstAttempt,
      latestAttemptId: secondAttempt.id,
      currentDocumentKey: firstAttempt.key,
    }),
    false,
  )
  assert.equal(
    savedLatestDocumentSnapshot({
      attempt: secondAttempt,
      latestAttemptId: secondAttempt.id,
      currentDocument: {
        key: secondAttempt.key,
        document: firstDocument,
        dirty: true,
      },
    }),
    false,
  )
  assert.equal(
    savedLatestDocumentSnapshot({
      attempt: secondAttempt,
      latestAttemptId: secondAttempt.id,
      currentDocument: {
        key: secondAttempt.key,
        document: secondDocument,
        dirty: true,
      },
    }),
    true,
  )
})

test('editor exposes retryable autosave failure state and resets it per document', () => {
  assert.match(clientPageSource, /title='Changes not saved'/)
  assert.match(clientPageSource, />\s*Retry\s*</)
  assert.match(
    clientPageSource,
    /savedLatestDocumentSnapshot\([\s\S]*setAutosaveFailure\(null\)/,
  )
  assert.match(
    clientPageSource,
    /useEffect\(\(\) => \{\s*documentActivityRef\.current = false\s*setAutosaveFailure\(null\)/,
  )
  assert.match(
    clientPageSource,
    /shouldAttemptAutomaticSave\(documentToSave, autosaveFailure\)/,
  )
})

test('failed save preserves dirty only for the failed document snapshot', () => {
  const currentKey = 'server-1@http://localhost:8888::project-1/campaign.icmp'
  const savedDocument: LoadedDocument = {
    key: currentKey,
    dirty: true,
    document: { content: { campaignName: 'Failed Save' } },
  }
  const laterDocument: LoadedDocument = {
    key: currentKey,
    dirty: true,
    document: { content: { campaignName: 'Edited Again' } },
  }

  const preservedDocument = preserveDirtyAfterFailedSave(
    savedDocument,
    savedDocument,
  )

  assert.equal(preservedDocument?.dirty, true)
  assert.notEqual(preservedDocument, savedDocument)
  assert.equal(
    preserveDirtyAfterFailedSave(laterDocument, savedDocument),
    laterDocument,
  )
})

test('save barrier skips saving a clean document', async () => {
  const currentKey = 'server::project/file.icmp'
  const latestDocument: LoadedDocument = {
    key: currentKey,
    dirty: false,
    document: { content: { campaignName: 'Clean' } },
  }
  let saveCalls = 0

  await flushDocumentSaveBarrier({
    currentDocumentKey: currentKey,
    getLatestDocument: () => latestDocument,
    getInFlightSave: () => null,
    saveDocument: async () => {
      saveCalls += 1
    },
  })

  assert.equal(saveCalls, 0)
})

test('save barrier immediately saves a dirty document', async () => {
  const currentKey = 'server::project/file.icmp'
  let latestDocument: LoadedDocument = {
    key: currentKey,
    dirty: true,
    document: { content: { campaignName: 'Dirty' } },
  }

  await flushDocumentSaveBarrier({
    currentDocumentKey: currentKey,
    getLatestDocument: () => latestDocument,
    getInFlightSave: () => null,
    saveDocument: async (documentToSave) => {
      latestDocument = { ...documentToSave, dirty: false }
    },
  })

  assert.equal(latestDocument.dirty, false)
})

test('save barrier waits for an active save and flushes newer edits', async () => {
  const currentKey = 'server::project/file.icmp'
  let finishActiveSave: (() => void) | undefined
  const activeSave = new Promise<void>((resolve) => {
    finishActiveSave = resolve
  })
  const newerDocument: LoadedDocument = {
    key: currentKey,
    dirty: true,
    document: { content: { campaignName: 'Newer edit' } },
  }
  let latestDocument = newerDocument
  const savedDocuments: LoadedDocument[] = []

  const preparation = flushDocumentSaveBarrier({
    currentDocumentKey: currentKey,
    getLatestDocument: () => latestDocument,
    getInFlightSave: () => activeSave,
    saveDocument: async (documentToSave) => {
      savedDocuments.push(documentToSave)
      latestDocument = { ...documentToSave, dirty: false }
    },
  })

  assert.deepEqual(savedDocuments, [])
  finishActiveSave?.()
  await preparation

  assert.deepEqual(savedDocuments, [newerDocument])
})

test('save barrier persists every dirty snapshot that arrives while saving', async () => {
  const currentKey = 'server::project/file.icmp'
  const snapshots: LoadedDocument[] = [
    {
      key: currentKey,
      dirty: true,
      document: { content: { campaignName: 'First' } },
    },
    {
      key: currentKey,
      dirty: true,
      document: { content: { campaignName: 'Second' } },
    },
    {
      key: currentKey,
      dirty: true,
      document: { content: { campaignName: 'Third' } },
    },
  ]
  let latestDocument = snapshots[0]
  const savedDocuments: LoadedDocument[] = []

  await flushDocumentSaveBarrier({
    currentDocumentKey: currentKey,
    getLatestDocument: () => latestDocument,
    getInFlightSave: () => null,
    saveDocument: async (documentToSave) => {
      savedDocuments.push(documentToSave)
      const nextSnapshot = snapshots[savedDocuments.length]
      latestDocument = nextSnapshot ?? { ...documentToSave, dirty: false }
    },
  })

  assert.deepEqual(savedDocuments, snapshots)
  assert.equal(latestDocument.dirty, false)
})

test('save barrier rejects and preserves dirty state when save fails', async () => {
  const currentKey = 'server::project/file.icmp'
  const latestDocument: LoadedDocument = {
    key: currentKey,
    dirty: true,
    document: { content: { campaignName: 'Unsaved' } },
  }

  await assert.rejects(
    flushDocumentSaveBarrier({
      currentDocumentKey: currentKey,
      getLatestDocument: () => latestDocument,
      getInFlightSave: () => null,
      saveDocument: async () => {
        throw new Error('save failed')
      },
    }),
    /save failed/,
  )
  assert.equal(latestDocument.dirty, true)
})

test('open editor rename preparation rejects reported background activity', () => {
  assert.match(
    clientPageSource,
    /if \(documentActivityRef\.current\) \{\s*return false/,
  )
  assert.match(clientPageSource, /isBusy: \(\) => documentActivityRef\.current/)
  assert.equal(
    [
      ...clientPageSource.matchAll(
        /onDocumentActivityChange=\{handleDocumentActivityChange\}/g,
      ),
    ].length,
    2,
  )
  assert.match(
    clientPageSource,
    /onDocumentActivityChange: handleDocumentActivityChange/,
  )
})

test('navigation preparation checks document activity around the save barrier', () => {
  const barrierStart = clientPageSource.indexOf(
    'const prepareDocumentSaveBarrier = useCallback',
  )
  const barrierEnd = clientPageSource.indexOf(
    '/** Flushes focused input drafts before application-controlled navigation. */',
    barrierStart,
  )
  const barrierSource = clientPageSource.slice(barrierStart, barrierEnd)

  assert.ok(barrierStart >= 0)
  assert.ok(barrierEnd > barrierStart)
  assert.ok(
    barrierSource.indexOf('documentActivityRef.current') <
      barrierSource.indexOf('renameLockRef.current = true'),
  )
  assert.match(
    barrierSource,
    /requestAnimationFrame[\s\S]*?documentActivityRef\.current[\s\S]*?flushDocumentSaveBarrier/,
  )
  assert.match(
    barrierSource,
    /saveDocument: async \(documentToSave\) => \{\s*if \(rejectDocumentActivity && documentActivityRef\.current\)/,
  )
  assert.match(
    barrierSource,
    /await flushDocumentSaveBarrier[\s\S]*?if \(rejectDocumentActivity && documentActivityRef\.current\)/,
  )
  assert.match(
    clientPageSource,
    /prepareDocumentSaveBarrier\(false, false, true\)/,
  )
})

test('rename lock continues accepting final document content updates', () => {
  const updateFunction = clientPageSource.match(
    /const updateDocumentContent = useCallback\([\s\S]*?\n {2}\)/,
  )

  assert.ok(updateFunction)
  assert.match(updateFunction[0], /applyDocumentContentUpdate/)
  assert.doesNotMatch(updateFunction[0], /renameLockRef/)
})

test('bootstrap verifies requested paths before resolving mappings and autosaves remain protected', () => {
  assert.match(
    clientPageSource,
    /const contentPath =[\s\S]*requestedContentPath[\s\S]*bootstrapProjectFile\(/,
  )
  assert.match(
    clientPageSource,
    /readRequestedFile:[\s\S]*requestedContentPath[\s\S]*resolveContentPath:[\s\S]*projectFileCoordinator\.resolveContentPath/,
  )
  assert.match(
    clientPageSource,
    /invalidateRenameMapping:[\s\S]*projectFileCoordinator\.invalidateRenameMapping/,
  )
  assert.match(
    clientPageSource,
    /result\.status === 'missing'[\s\S]*commitLoadedDocument\(undefined\)[\s\S]*File not found\. Reopen the file from project navigation\./,
  )
  assert.match(
    clientPageSource,
    /const currentContentPath = projectFileCoordinator\.resolveContentPath\(/,
  )
  assert.match(
    clientPageSource,
    /renameProjectFileTabs\([\s\S]*requestedContentPath[\s\S]*contentPath/,
  )
  assert.match(
    clientPageSource,
    /router\.replace\(buildProjectFileRoute\(project_id, resolvedFilePath\)\)/,
  )
})

test('chat downloads use the canonical content basename', () => {
  assert.match(
    clientPageSource,
    /<Chat[\s\S]*downloadFileName=\{contentPath\.split\('\/'\)\.at\(-1\) \?\? resolvedFilePath\}/,
  )
})

test('rename preparation paints the lock before flushing and pauses shared ownership', () => {
  assert.match(
    clientPageSource,
    /setRenameLocked\(true\)[\s\S]*requestAnimationFrame[\s\S]*flushDocumentSaveBarrier/,
  )
  assert.match(
    clientPageSource,
    /pauseSharedLock: \(\) => sharedLockController\.release\(\)/,
  )
  assert.match(
    clientPageSource,
    /resumeSharedLock: \(\) => sharedLockController\.acquire\(\)/,
  )
})

test('plain text file content renders unchanged', () => {
  assert.equal(normalizeTextFileContent('alpha\nbeta'), 'alpha\nbeta')
})

test('object JSON content renders as indented JSON', () => {
  assert.equal(
    normalizeJsonFileContent({
      alpha: 1,
      beta: true,
    }),
    '{\n  "alpha": 1,\n  "beta": true\n}',
  )
})

test('string JSON content parses and renders as indented JSON', () => {
  assert.equal(
    normalizeJsonFileContent('{"alpha":1,"items":["a","b"]}'),
    '{\n  "alpha": 1,\n  "items": [\n    "a",\n    "b"\n  ]\n}',
  )
})

test('top-level JSON string content renders with JSON quoting', () => {
  assert.equal(normalizeJsonFileContent('"abc"'), '"abc"')
})

test('top-level JSON string content renders with JSON escaping', () => {
  assert.equal(normalizeJsonFileContent('"a\\nb"'), '"a\\nb"')
})

test('invalid JSON string content falls back to raw text', () => {
  assert.equal(normalizeJsonFileContent('{"alpha":'), '{"alpha":')
})

test('non-string text content renders without throwing', () => {
  assert.equal(
    normalizeTextFileContent({
      alpha: 1,
    }),
    '{\n  "alpha": 1\n}',
  )
})

test('string content parsing can be preserved for text-like files', () => {
  assert.deepEqual(
    parseLoadedDocumentContent(
      {
        type: 'file',
        content: '{"alpha":1}',
      },
      { preserveStringContent: true },
    ),
    {
      type: 'file',
      content: '{"alpha":1}',
    },
  )
})

test('file extension normalization is case-insensitive', () => {
  assert.equal(getNormalizedFileExtension('notes.TXT'), 'txt')
  assert.equal(getNormalizedFileExtension('data.JSON'), 'json')
  assert.equal(getNormalizedFileExtension('diagram.icmp'), 'icmp')
})
