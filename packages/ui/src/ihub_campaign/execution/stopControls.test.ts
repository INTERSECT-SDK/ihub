/* eslint-disable @typescript-eslint/no-require-imports -- Node's direct TS test runner needs require() for the sibling .ts helper without changing package module settings. */
const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')

const { canStopCampaign, handleCampaignStopConfirmationAction } =
  require('./stopControls.ts') as typeof import('./stopControls')

test('canStopCampaign requires a broker, executing state, and campaign run id', () => {
  assert.equal(
    canStopCampaign({
      intersectId: '1',
      isExecutingCampaign: true,
      isStoppingCampaign: false,
      activeCampaignRunId: 'run-1',
    }),
    true,
  )

  assert.equal(
    canStopCampaign({
      intersectId: null,
      isExecutingCampaign: true,
      isStoppingCampaign: false,
      activeCampaignRunId: 'run-1',
    }),
    false,
  )

  assert.equal(
    canStopCampaign({
      intersectId: '1',
      isExecutingCampaign: false,
      isStoppingCampaign: false,
      activeCampaignRunId: 'run-1',
    }),
    false,
  )

  assert.equal(
    canStopCampaign({
      intersectId: '1',
      isExecutingCampaign: true,
      isStoppingCampaign: false,
      activeCampaignRunId: null,
    }),
    false,
  )
})

test('canceling campaign stop confirmation closes without calling stop', async () => {
  let stopCalls = 0
  let closeCalls = 0

  const stopped = await handleCampaignStopConfirmationAction('cancel', {
    stop: async () => {
      stopCalls += 1
      return true
    },
    close: () => {
      closeCalls += 1
    },
  })

  assert.equal(stopped, false)
  assert.equal(stopCalls, 0)
  assert.equal(closeCalls, 1)
})

test('closing campaign stop confirmation closes without calling stop', async () => {
  let stopCalls = 0
  let closeCalls = 0

  const stopped = await handleCampaignStopConfirmationAction('close', {
    stop: async () => {
      stopCalls += 1
      return true
    },
    close: () => {
      closeCalls += 1
    },
  })

  assert.equal(stopped, false)
  assert.equal(stopCalls, 0)
  assert.equal(closeCalls, 1)
})

test('confirming campaign stop calls stop once and closes after success', async () => {
  let stopCalls = 0
  let closeCalls = 0

  const stopped = await handleCampaignStopConfirmationAction('confirm', {
    stop: async () => {
      stopCalls += 1
      return true
    },
    close: () => {
      closeCalls += 1
    },
  })

  assert.equal(stopped, true)
  assert.equal(stopCalls, 1)
  assert.equal(closeCalls, 1)
})

test('failed campaign stop confirmation leaves the modal open', async () => {
  let stopCalls = 0
  let closeCalls = 0

  const stopped = await handleCampaignStopConfirmationAction('confirm', {
    stop: async () => {
      stopCalls += 1
      return false
    },
    close: () => {
      closeCalls += 1
    },
  })

  assert.equal(stopped, false)
  assert.equal(stopCalls, 1)
  assert.equal(closeCalls, 0)
})
