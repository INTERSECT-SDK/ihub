/* eslint-disable @typescript-eslint/no-require-imports -- Node reads repository JSON contracts directly. */
const {
  readFileSync,
  readdirSync,
}: typeof import('node:fs') = require('node:fs')
const { join }: typeof import('node:path') = require('node:path')
const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')

type JsonObject = Record<string, unknown>

const fixtureRoot = join(
  __dirname,
  '../../../../..',
  'contracts',
  'campaign',
  'fixtures',
)
const serializationDirectory = join(fixtureRoot, 'serialization')
const editorDirectory = join(fixtureRoot, 'editor')

function loadFixture(directory: string, name: string): JsonObject {
  return JSON.parse(readFileSync(join(directory, name), 'utf8')) as JsonObject
}

test('shared fixture library contains only canonical serialization contracts', () => {
  assert.deepEqual(readdirSync(serializationDirectory).sort(), [
    'canonical-campaign.input.json',
    'canonical-campaign.serialized.json',
  ])
  assert.equal(
    loadFixture(serializationDirectory, 'canonical-campaign.input.json').id,
    'contract-campaign-001',
  )
})

test('canonical editor fixture retains current editor extensions', () => {
  const fixture = loadFixture(editorDirectory, 'canonical-campaign.editor.json')
  const groups = fixture.task_groups as Array<{
    tasks: Array<Record<string, unknown>>
    ui_edges: Array<Record<string, unknown>>
  }>
  const tasks = groups.flatMap(({ tasks }) => tasks)

  assert.ok(tasks.some(({ event_name }) => Boolean(event_name)))
  assert.ok(tasks.some(({ hierarchy }) => hierarchy === 'json-file'))
  assert.ok(tasks.some(({ hierarchy }) => hierarchy === 'json-text'))
  assert.ok(tasks.some(({ hierarchy }) => hierarchy === 'visualization'))
  assert.ok(tasks.some(({ hierarchy }) => hierarchy === 'renderer'))
  assert.ok(groups.some(({ ui_edges }) => ui_edges.length > 0))
  assert.equal(
    fixture.unknown_document_property,
    'preserve-canonical-document-extension',
  )
})
