/* eslint-disable @typescript-eslint/no-require-imports -- Node's direct TypeScript test runner uses CommonJS in this package. */
const assert: typeof import('node:assert/strict') = require('node:assert/strict')
const { test }: typeof import('node:test') = require('node:test')

const {
  defaultCampaignViewport,
  getCampaignSheetViewport,
}: typeof import('./campaignViewport') = require('./campaignViewport.ts')

test('returns independent saved viewports for campaign sheets', () => {
  const viewports = {
    campaign: { x: 120, y: -40, zoom: 1.2 },
    group: { x: -25, y: 75, zoom: 0.7 },
  }

  assert.equal(
    getCampaignSheetViewport('campaign', viewports),
    viewports.campaign,
  )
  assert.equal(getCampaignSheetViewport('group', viewports), viewports.group)
})

test('returns the default viewport for an unsaved sheet', () => {
  const viewport = getCampaignSheetViewport('missing', undefined)

  assert.deepEqual(viewport, defaultCampaignViewport)
  assert.notEqual(viewport, defaultCampaignViewport)
})
