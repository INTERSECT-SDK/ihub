/* eslint-disable @typescript-eslint/no-require-imports -- Node runs these TypeScript tests directly. */
const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')

const { EVENT_MODE_TOOLTIPS } =
  require('./eventModeTooltips.ts') as typeof import('./eventModeTooltips')

test('describes every campaign event mode', () => {
  assert.deepEqual(EVENT_MODE_TOOLTIPS, {
    once: 'Completes after it receives the first matching event.',
    count:
      'Remains Executing until it has received the configured number of matching events.',
    persistent:
      'Continues listening for matching events throughout the campaign. Even when a STEP_COMPLETE event is received, the status remains Executing until the campaign is complete.',
  })
})
