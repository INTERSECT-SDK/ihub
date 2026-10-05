/* eslint-disable @typescript-eslint/no-require-imports -- Node's direct TS test runner needs require() for sibling TypeScript modules. */
const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')

const { runCampaignStartSingleFlight } =
  require('./startSingleFlight.ts') as typeof import('./startSingleFlight')
const { getCampaignRunControlState } =
  require('./runControls.ts') as typeof import('./runControls')

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

test('two immediate starts share one pending preparation and keep execution idle', async () => {
  const preparation = deferred()
  const guard = { current: false }
  const startingStates: boolean[] = []
  let materializationCalls = 0
  let campaignStartCalls = 0
  let executionStatus = 'idle'

  const start = async () => {
    materializationCalls += 1
    await preparation.promise
    campaignStartCalls += 1
    executionStatus = 'executing'
  }
  const options = {
    guard,
    onStartingChange: (isStarting: boolean) => {
      startingStates.push(isStarting)
    },
    start,
  }

  const first = runCampaignStartSingleFlight(options)
  const second = runCampaignStartSingleFlight(options)

  assert.equal(materializationCalls, 1)
  assert.equal(campaignStartCalls, 0)
  assert.equal(executionStatus, 'idle')
  assert.equal(guard.current, true)
  assert.deepEqual(
    getCampaignRunControlState({
      isStartingCampaign: true,
      isExecutingCampaign: false,
      intersectId: '1',
      selectedBrokerStatus: 'connected',
      hasExecutableCapability: true,
    }),
    {
      disabled: true,
      hoverInfo: 'Campaign is starting',
      showTooltipWhenDisabled: true,
    },
  )

  preparation.resolve()
  assert.deepEqual(await Promise.all([first, second]), [true, false])
  assert.equal(campaignStartCalls, 1)
  assert.equal(executionStatus, 'executing')
  assert.equal(guard.current, false)
  assert.deepEqual(startingStates, [true, false])
})

test('failed start releases the guard and permits a retry', async () => {
  const guard = { current: false }
  const startingStates: boolean[] = []
  let attempts = 0

  const runAttempt = () =>
    runCampaignStartSingleFlight({
      guard,
      onStartingChange: (isStarting) => startingStates.push(isStarting),
      start: async () => {
        attempts += 1
        if (attempts === 1) {
          throw new Error('materialization timed out')
        }
      },
    })

  await assert.rejects(runAttempt, /materialization timed out/)
  assert.equal(guard.current, false)
  assert.equal(await runAttempt(), true)
  assert.equal(attempts, 2)
  assert.deepEqual(startingStates, [true, false, true, false])
})
