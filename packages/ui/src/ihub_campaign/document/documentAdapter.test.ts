/* eslint-disable @typescript-eslint/no-require-imports -- Node's direct TS runner uses require(). */
const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')

const {
  CampaignDocumentAdapterError,
  classifyCampaignDocument,
}: typeof import('./classify') = require('./classify.ts')
const {
  createCanonicalDocumentSession,
}: typeof import('./canonicalAdapter') = require('./canonicalAdapter.ts')

function canonicalDocument() {
  return {
    id: 'campaign-1',
    run_id: 'run-1',
    name: 'Campaign',
    user: 'owner',
    description: 'Canonical campaign',
    task_groups: [],
    objectives: null,
    inputs: [],
    outputs: [],
    extension: { nested: ['preserved'] },
  }
}

test('accepts CampaignModel and rejects retired, hybrid, malformed, and unknown documents', () => {
  assert.equal(classifyCampaignDocument(canonicalDocument()), 'campaign-model')
  const cases = [
    { document: null, code: 'unsupported-document' },
    {
      document: { task_groups: [], id: '', run_id: 'run-1' },
      code: 'invalid-canonical-document',
    },
    {
      document: { campaignId: 'legacy-1', nodes: [], edges: [] },
      code: 'legacy-document',
    },
    {
      document: {
        ...canonicalDocument(),
        campaignId: 'legacy-1',
        nodes: [],
        edges: [],
      },
      code: 'ambiguous-document',
    },
  ]
  for (const { document, code } of cases) {
    assert.throws(
      () => classifyCampaignDocument(document),
      (error: unknown) =>
        error instanceof CampaignDocumentAdapterError && error.code === code,
    )
  }
})

test('retired legacy rejection uses the stable user-facing message', () => {
  assert.throws(
    () =>
      classifyCampaignDocument({
        campaignId: 'legacy-1',
        nodes: [],
        edges: [],
      }),
    /This campaign uses the retired legacy format and cannot be opened\. Create a new campaign using the current CampaignModel format\./,
  )
})

test('canonical sessions clone input and reject non-serializable data', () => {
  const source = canonicalDocument()
  const session = createCanonicalDocumentSession(source)
  assert.deepEqual(session.model, source)
  assert.notEqual(session.model, source)
  session.model.name = 'Edited'
  assert.equal(source.name, 'Campaign')

  const cyclic = canonicalDocument() as ReturnType<typeof canonicalDocument> & {
    cyclic?: unknown
  }
  cyclic.cyclic = cyclic
  assert.throws(
    () => createCanonicalDocumentSession(cyclic),
    (error: unknown) =>
      error instanceof CampaignDocumentAdapterError &&
      error.code === 'non-serializable-document',
  )
})
