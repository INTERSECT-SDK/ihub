import test from 'node:test'
import assert from 'node:assert/strict'

import {
  HUB_SIDE_NAVBAR_COLLAPSED_WIDTH,
  HUB_SIDE_NAVBAR_MAX_OPEN_WIDTH,
  HUB_SIDE_NAVBAR_MIN_OPEN_WIDTH,
  getSidePanelResizeWidth,
} from './side-panel-resize.ts'

test('side panel resize accepts widths inside the open range', () => {
  assert.equal(getSidePanelResizeWidth(280), 280)
  assert.equal(getSidePanelResizeWidth(450), 450)
  assert.equal(getSidePanelResizeWidth(720), 720)
})

test('side panel resize clamps widths above the maximum', () => {
  assert.equal(getSidePanelResizeWidth(900), HUB_SIDE_NAVBAR_MAX_OPEN_WIDTH)
})

test('side panel resize clamps widths below the minimum', () => {
  assert.equal(
    getSidePanelResizeWidth(HUB_SIDE_NAVBAR_MIN_OPEN_WIDTH - 1),
    HUB_SIDE_NAVBAR_MIN_OPEN_WIDTH,
  )
})

test('side panel resize keeps the panel open at the minimum width', () => {
  assert.equal(
    getSidePanelResizeWidth(HUB_SIDE_NAVBAR_MIN_OPEN_WIDTH),
    HUB_SIDE_NAVBAR_MIN_OPEN_WIDTH,
  )
})

test('collapsed side panel width remains the icon rail width', () => {
  assert.equal(HUB_SIDE_NAVBAR_COLLAPSED_WIDTH, 60)
})
