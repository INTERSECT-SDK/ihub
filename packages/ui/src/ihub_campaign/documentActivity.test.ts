/* eslint-disable @typescript-eslint/no-require-imports -- Node's direct TypeScript test runner uses CommonJS in this package. */
const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')

const {
  createCampaignDocumentActivityCleanup,
  hasCampaignDocumentActivity,
  reportCampaignDocumentActivity,
}: typeof import('./editor/useCampaignDocumentActivity') = require('./editor/useCampaignDocumentActivity.ts')

test('campaign start and stop transitions block document navigation', () => {
  assert.equal(hasCampaignDocumentActivity(true, false, false), true)
  assert.equal(hasCampaignDocumentActivity(false, false, true), true)
})

test('campaign execution does not block document navigation', () => {
  assert.equal(hasCampaignDocumentActivity(false, true, false), false)
  assert.equal(hasCampaignDocumentActivity(false, false, false), false)
})

test('campaign activity reporting forwards transitions and clears on cleanup', () => {
  const reports: boolean[] = []
  const callback = (active: boolean) => reports.push(active)

  reportCampaignDocumentActivity(callback, true)
  reportCampaignDocumentActivity(callback, false)
  createCampaignDocumentActivityCleanup(callback)()

  assert.deepEqual(reports, [true, false, false])
})
