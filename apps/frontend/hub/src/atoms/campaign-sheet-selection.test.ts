import assert from 'node:assert/strict'
import test from 'node:test'

import { createStore } from 'jotai/vanilla'

import {
  activeTabAtom,
  openTabsAtom,
  setTabCampaignSheetAtom,
} from './global.ts'
import type { Tab } from '../types.ts'

const campaignTab: Tab = {
  id: 'campaign',
  title: 'Campaign',
  path: '/project/a/campaign.icmp',
}
const otherTab: Tab = {
  id: 'other',
  title: 'Other',
  path: '/project/a/other.icmp',
  selectedCampaignSheetId: 'other-group',
}

test('updates the matching open and active campaign tab only', () => {
  const store = createStore()
  store.set(openTabsAtom, [campaignTab, otherTab])
  store.set(activeTabAtom, campaignTab)

  store.set(setTabCampaignSheetAtom, campaignTab.id, 'campaign-group')

  assert.deepEqual(store.get(openTabsAtom), [
    { ...campaignTab, selectedCampaignSheetId: 'campaign-group' },
    otherTab,
  ])
  assert.deepEqual(store.get(activeTabAtom), {
    ...campaignTab,
    selectedCampaignSheetId: 'campaign-group',
  })
})

test('updates an inactive campaign tab without changing the active tab', () => {
  const store = createStore()
  store.set(openTabsAtom, [campaignTab, otherTab])
  store.set(activeTabAtom, otherTab)

  store.set(setTabCampaignSheetAtom, campaignTab.id, 'campaign-group')

  assert.equal(
    store.get(openTabsAtom)[0]?.selectedCampaignSheetId,
    'campaign-group',
  )
  assert.equal(store.get(activeTabAtom), otherTab)
})

test('ignores an unknown tab id', () => {
  const store = createStore()
  store.set(openTabsAtom, [campaignTab, otherTab])
  store.set(activeTabAtom, campaignTab)

  store.set(setTabCampaignSheetAtom, 'missing', 'campaign-group')

  assert.equal(store.get(openTabsAtom)[0], campaignTab)
  assert.equal(store.get(openTabsAtom)[1], otherTab)
  assert.equal(store.get(activeTabAtom), campaignTab)
})
