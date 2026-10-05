/* eslint-disable @typescript-eslint/no-require-imports -- Node's direct TypeScript test runner uses CommonJS in this package. */
const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')
const React: typeof import('react') = require('react')
const {
  renderToStaticMarkup,
}: typeof import('react-dom/server') = require('react-dom/server')

const {
  CampaignViewContext,
  createCampaignViewMutationGuard,
  useCampaignView,
}: typeof import('./campaignViewContext') = require('./campaignViewContext.ts')

function ViewSettingsConsumer() {
  const { provenanceKey, readOnly } = useCampaignView()
  return React.createElement(
    'span',
    null,
    `${provenanceKey}:${readOnly ? 'read-only' : 'editable'}`,
  )
}

test('campaign descendants receive the selected view settings', () => {
  const latestScope = { provenanceKey: 'campaign:current', readOnly: false }
  const canMutate = createCampaignViewMutationGuard(() => latestScope)
  const markup = renderToStaticMarkup(
    React.createElement(
      CampaignViewContext.Provider,
      { value: { ...latestScope, canMutate } },
      React.createElement(ViewSettingsConsumer),
    ),
  )

  assert.equal(markup, '<span>campaign:current:editable</span>')
})

test('only work from the latest editable provenance may mutate', () => {
  let latestScope = { provenanceKey: 'campaign:current', readOnly: false }
  const canMutate = createCampaignViewMutationGuard(() => latestScope)

  assert.equal(canMutate(), true)
  assert.equal(canMutate('campaign:current'), true)

  latestScope = { provenanceKey: 'run:a', readOnly: true }
  assert.equal(canMutate(), false)
  assert.equal(canMutate('campaign:current'), false)

  latestScope = { provenanceKey: 'campaign:current', readOnly: false }
  assert.equal(canMutate('run:a'), false)
  assert.equal(canMutate('campaign:current'), true)
})

test('stale scheduled work is rejected after another editable scope becomes active', () => {
  let latestScope = { provenanceKey: 'campaign:a', readOnly: false }
  const canMutate = createCampaignViewMutationGuard(() => latestScope)
  const scheduledProvenanceKey = latestScope.provenanceKey

  latestScope = { provenanceKey: 'campaign:b', readOnly: false }

  assert.equal(canMutate(scheduledProvenanceKey), false)
})
