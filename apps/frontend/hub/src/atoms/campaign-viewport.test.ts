import assert from 'node:assert/strict'
import test from 'node:test'

import { createStore } from 'jotai/vanilla'

import {
  activeTabAtom,
  openTabsAtom,
  setTabCampaignViewportAtom,
} from './global.ts'
import type { Tab } from '../types.ts'

const firstCampaign: Tab = {
  id: 'first-campaign',
  title: 'First Campaign',
  path: '/project/a/first.icmp',
}
const secondCampaign: Tab = {
  id: 'second-campaign',
  title: 'Second Campaign',
  path: '/project/a/second.icmp',
}

test('stores independent viewports for multiple sheets in one campaign tab', () => {
  const store = createStore()
  store.set(openTabsAtom, [firstCampaign])
  store.set(activeTabAtom, firstCampaign)

  store.set(setTabCampaignViewportAtom, firstCampaign.id, 'campaign', {
    x: 100,
    y: -50,
    zoom: 1.2,
  })
  store.set(setTabCampaignViewportAtom, firstCampaign.id, 'group-one', {
    x: -20,
    y: 80,
    zoom: 0.7,
  })

  assert.deepEqual(store.get(openTabsAtom)[0]?.campaignSheetViewports, {
    campaign: { x: 100, y: -50, zoom: 1.2 },
    'group-one': { x: -20, y: 80, zoom: 0.7 },
  })
  assert.deepEqual(store.get(activeTabAtom), store.get(openTabsAtom)[0])
})

test('keeps viewport state isolated between campaign tabs', () => {
  const store = createStore()
  store.set(openTabsAtom, [firstCampaign, secondCampaign])
  store.set(activeTabAtom, secondCampaign)

  store.set(setTabCampaignViewportAtom, firstCampaign.id, 'campaign', {
    x: 10,
    y: 20,
    zoom: 1.1,
  })
  store.set(setTabCampaignViewportAtom, secondCampaign.id, 'campaign', {
    x: -30,
    y: -40,
    zoom: 0.8,
  })

  assert.deepEqual(store.get(openTabsAtom)[0]?.campaignSheetViewports, {
    campaign: { x: 10, y: 20, zoom: 1.1 },
  })
  assert.deepEqual(store.get(openTabsAtom)[1]?.campaignSheetViewports, {
    campaign: { x: -30, y: -40, zoom: 0.8 },
  })
  assert.deepEqual(store.get(activeTabAtom), store.get(openTabsAtom)[1])
})

test('updates an inactive tab without replacing the active tab record', () => {
  const store = createStore()
  store.set(openTabsAtom, [firstCampaign, secondCampaign])
  store.set(activeTabAtom, secondCampaign)

  store.set(setTabCampaignViewportAtom, firstCampaign.id, 'campaign', {
    x: 5,
    y: 6,
    zoom: 1,
  })

  assert.deepEqual(store.get(openTabsAtom)[0]?.campaignSheetViewports, {
    campaign: { x: 5, y: 6, zoom: 1 },
  })
  assert.equal(store.get(activeTabAtom), secondCampaign)
})

test('ignores viewport updates from a stale tab id', () => {
  const store = createStore()
  store.set(openTabsAtom, [firstCampaign, secondCampaign])
  store.set(activeTabAtom, firstCampaign)

  store.set(setTabCampaignViewportAtom, 'closed-campaign', 'campaign', {
    x: 5,
    y: 6,
    zoom: 1,
  })

  assert.equal(store.get(openTabsAtom)[0], firstCampaign)
  assert.equal(store.get(openTabsAtom)[1], secondCampaign)
  assert.equal(store.get(activeTabAtom), firstCampaign)
})
