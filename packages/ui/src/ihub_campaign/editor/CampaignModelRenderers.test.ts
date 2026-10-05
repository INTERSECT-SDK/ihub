/* eslint-disable @typescript-eslint/no-require-imports -- Node's direct TypeScript test runner uses CommonJS in this package. */
const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')

const {
  campaignModelNodeTypeKeys,
  createCampaignNodeTypes,
}: typeof import('./CampaignNodeRegistry') = require('./CampaignNodeRegistry.ts')

test('CampaignModel exposes a renderer for every supported graph node type', () => {
  function NamedCampaignNodeRenderer() {
    return null
  }
  const renderers = {
    taskGroup: NamedCampaignNodeRenderer,
    capability: NamedCampaignNodeRenderer,
    event: NamedCampaignNodeRenderer,
    code: NamedCampaignNodeRenderer,
    visualization: NamedCampaignNodeRenderer,
    'image-renderer': NamedCampaignNodeRenderer,
    'text-renderer': NamedCampaignNodeRenderer,
    'json-file': NamedCampaignNodeRenderer,
    'json-text': NamedCampaignNodeRenderer,
  }

  const registry = createCampaignNodeTypes(renderers)

  assert.deepEqual(Object.keys(registry), [...campaignModelNodeTypeKeys])
  for (const nodeType of campaignModelNodeTypeKeys) {
    assert.equal(registry[nodeType], renderers[nodeType])
  }
})
