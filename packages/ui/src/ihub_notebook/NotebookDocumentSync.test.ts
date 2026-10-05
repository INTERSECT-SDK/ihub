/* eslint-disable @typescript-eslint/no-require-imports -- Node's direct TS test runner needs require() for sibling .ts helpers without changing package module settings. */
const { readFileSync }: typeof import('node:fs') = require('node:fs')
const { join }: typeof import('node:path') = require('node:path')
const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')

const { getNotebookDocumentPublishDecision } =
  require('./NotebookDocumentSync.ts') as typeof import('./NotebookDocumentSync')
const { updateNotebookExecutionActivity } =
  require('./NotebookActivity.ts') as typeof import('./NotebookActivity')

test('notebook document publishing skips provider defaults before hydration', () => {
  assert.deepEqual(
    getNotebookDocumentPublishDecision({
      hasPublishedHydratedNotebook: false,
      isHydratedNotebookSnapshot: false,
    }),
    {
      shouldPublish: false,
      dirty: false,
    },
  )
})

test('notebook document publishing marks the hydrated notebook snapshot clean', () => {
  assert.deepEqual(
    getNotebookDocumentPublishDecision({
      hasPublishedHydratedNotebook: false,
      isHydratedNotebookSnapshot: true,
    }),
    {
      shouldPublish: true,
      dirty: false,
    },
  )
})

test('notebook document publishing marks later notebook changes dirty', () => {
  assert.deepEqual(
    getNotebookDocumentPublishDecision({
      hasPublishedHydratedNotebook: true,
      isHydratedNotebookSnapshot: false,
    }),
    {
      shouldPublish: true,
      dirty: true,
    },
  )
})

test('notebook document publishing uses the latest setter without depending on setter identity', () => {
  const notebookSource = readFileSync(join(__dirname, 'Notebook.tsx'), 'utf8')

  assert.match(
    notebookSource,
    /const setDocumentContentRef = useRef\(setDocumentContent\)/,
  )
  assert.match(
    notebookSource,
    /setDocumentContentRef\.current = setDocumentContent/,
  )
  assert.match(notebookSource, /\}, \[allNoteBookData\]\)/)
  assert.doesNotMatch(
    notebookSource,
    /\}, \[allNoteBookData, setDocumentContent\]\)/,
  )
})

test('notebook activity remains active until every executing cell settles', () => {
  const firstStart = updateNotebookExecutionActivity(
    new Set<string>(),
    'cell-a',
    true,
  )
  assert.equal(firstStart.didBecomeActive, true)
  assert.equal(firstStart.didBecomeIdle, false)

  const secondStart = updateNotebookExecutionActivity(
    firstStart.executingCellIds,
    'cell-b',
    true,
  )
  assert.equal(secondStart.didBecomeActive, false)
  assert.equal(secondStart.executingCellIds.size, 2)

  const firstFinish = updateNotebookExecutionActivity(
    secondStart.executingCellIds,
    'cell-a',
    false,
  )
  assert.equal(firstFinish.didBecomeIdle, false)
  assert.deepEqual([...firstFinish.executingCellIds], ['cell-b'])

  const secondFinish = updateNotebookExecutionActivity(
    firstFinish.executingCellIds,
    'cell-b',
    false,
  )
  assert.equal(secondFinish.didBecomeIdle, true)
  assert.equal(secondFinish.executingCellIds.size, 0)
})

test('notebook cells clear execution activity during kernel replacement and unmount', () => {
  const cellSource = readFileSync(join(__dirname, 'Cell.tsx'), 'utf8')

  assert.match(
    cellSource,
    /executionCleanupRef\.current\?\.\(\)[\s\S]*setExecutionActive\(false\)[\s\S]*\}, \[jupyterSession, setExecutionActive\]\)/,
  )
})

test('notebook cells clear execution activity on socket close, error, and immediate failure', () => {
  const cellSource = readFileSync(join(__dirname, 'Cell.tsx'), 'utf8')

  assert.match(
    cellSource,
    /connection\.addEventListener\('close', handleConnectionEnd\)/,
  )
  assert.match(
    cellSource,
    /connection\.addEventListener\('error', handleConnectionEnd\)/,
  )
  assert.match(
    cellSource,
    /if \(executionResult\?\.error\) \{\s*finishExecution\(false\)\s*return false/,
  )
  assert.match(
    cellSource,
    /catch \(error\) \{[\s\S]*finishExecution\(false\)[\s\S]*return false/,
  )
})

test('notebook terminal execution messages release activity for later executions', () => {
  const cellSource = readFileSync(join(__dirname, 'Cell.tsx'), 'utf8')

  assert.match(
    cellSource,
    /msgType === 'execute_reply' \|\| msgType === 'error'[\s\S]*finishExecution\(true\)/,
  )
  assert.match(
    cellSource,
    /executionCleanupRef\.current = null[\s\S]*return true/,
  )
})

test('notebook delays idle publication until after document publishing', () => {
  const notebookSource = readFileSync(join(__dirname, 'Notebook.tsx'), 'utf8')
  const documentPublishIndex = notebookSource.indexOf(
    'setDocumentContentRef.current(allNoteBookData.content',
  )
  const idlePublishIndex = notebookSource.indexOf(
    'onDocumentActivityChangeRef.current?.(false)',
  )

  assert.ok(documentPublishIndex >= 0)
  assert.ok(idlePublishIndex > documentPublishIndex)
})
