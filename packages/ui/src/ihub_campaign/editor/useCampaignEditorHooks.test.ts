/* eslint-disable @typescript-eslint/no-require-imports -- Node's direct TypeScript test runner uses CommonJS in this package. */
import type { CampaignModel } from '@ihub/utils/types/campaign'

const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')

const {
  toPlainJsonValue,
  getCampaignBrokerSelection,
  withSelectedBroker,
}: typeof import('./useCampaignModelPersistence') = require('./useCampaignModelPersistence.ts')
const {
  masterCampaignSheetId,
  resolveCampaignSheetId,
}: typeof import('./campaignEditorState') = require('./campaignEditorState.ts')

function createCampaignModel(): CampaignModel {
  return {
    id: 'campaign-1',
    run_id: 'run-1',
    name: 'Campaign',
    user: 'user',
    description: 'description',
    task_groups: [],
    objectives: null,
    inputs: [],
    outputs: [],
  }
}

test('persistence cloning detaches rapid edits and strips runtime-only values', () => {
  const source = {
    values: new Set(['first']),
    metadata: new Map([['count', 1]]),
    ignored: () => 'runtime only',
  }

  const first = toPlainJsonValue(source)
  source.values.add('second')
  const second = toPlainJsonValue(source)

  assert.deepEqual(first, { values: ['first'], metadata: { count: 1 } })
  assert.deepEqual(second, {
    values: ['first', 'second'],
    metadata: { count: 1 },
  })
})

test('broker persistence adds and removes selections without mutating input', () => {
  const campaignModel = createCampaignModel()
  const selected = withSelectedBroker(campaignModel, 'broker-7')
  const cleared = withSelectedBroker(selected, null)

  assert.equal(selected.selected_broker_id, 'broker-7')
  assert.equal(getCampaignBrokerSelection(selected), 'broker-7')
  assert.equal('selected_broker_id' in campaignModel, false)
  assert.equal('selected_broker_id' in cleared, false)
})

test('restored campaign sheets keep valid ids and reject missing ids', () => {
  const originalTabs = [
    { id: masterCampaignSheetId, label: 'Campaign' },
    { id: 'group-1', label: 'Task Group 1' },
  ]
  const replacementTabs = [{ id: masterCampaignSheetId, label: 'Campaign' }]

  assert.equal(resolveCampaignSheetId(originalTabs, 'group-1'), 'group-1')
  assert.equal(
    resolveCampaignSheetId(replacementTabs, 'group-1'),
    masterCampaignSheetId,
  )
})

test('an uncontrolled campaign sheet defaults to the Campaign overview', () => {
  const tabs = [
    { id: masterCampaignSheetId, label: 'Campaign' },
    { id: 'group-1', label: 'Task Group 1' },
  ]

  assert.equal(resolveCampaignSheetId(tabs), masterCampaignSheetId)
})
