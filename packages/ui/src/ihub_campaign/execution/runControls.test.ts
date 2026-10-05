/* eslint-disable @typescript-eslint/no-require-imports -- Node's direct TS test runner needs require() for sibling TypeScript modules. */
const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')

import type { CampaignModel, CampaignTask } from '@ihub/utils/types/campaign'

const {
  getCampaignRunControlState,
  isBrokerConnected,
  normalizeStartBrokerState,
} = require('./runControls.ts') as typeof import('./runControls')
const { hasExecutableCampaignTasks } =
  require('../model/selectors.ts') as typeof import('../model/selectors')

const connectedRunInput = {
  isStartingCampaign: false,
  isExecutingCampaign: false,
  intersectId: '1',
  selectedBrokerStatus: 'connected',
  hasExecutableCapability: true,
}

test('connected broker with an executable campaign enables Run', () => {
  assert.deepEqual(getCampaignRunControlState(connectedRunInput), {
    disabled: false,
    hoverInfo: 'Run campaign',
    showTooltipWhenDisabled: false,
  })
})

test('disconnected or unresolved broker disables Run', () => {
  for (const selectedBrokerStatus of [
    'disconnected',
    'connecting',
    undefined,
  ]) {
    assert.deepEqual(
      getCampaignRunControlState({
        ...connectedRunInput,
        selectedBrokerStatus,
      }),
      {
        disabled: true,
        hoverInfo:
          'The selected INTERSECT server must be connected to run this campaign',
        showTooltipWhenDisabled: true,
      },
    )
  }
})

test('missing broker selection disables Run before broker readiness', () => {
  assert.deepEqual(
    getCampaignRunControlState({
      ...connectedRunInput,
      intersectId: null,
      selectedBrokerStatus: undefined,
    }),
    {
      disabled: true,
      hoverInfo: 'Select an INTERSECT server',
      showTooltipWhenDisabled: true,
    },
  )
})

test('recovery state disables Run before execution and broker restrictions', () => {
  assert.deepEqual(
    getCampaignRunControlState({
      ...connectedRunInput,
      isExecutingCampaign: true,
      selectedBrokerStatus: 'disconnected',
      recoveryDisabledReason: 'Restoring the active campaign run',
    }),
    {
      disabled: true,
      hoverInfo: 'Restoring the active campaign run',
      showTooltipWhenDisabled: true,
    },
  )
})

test('starting state takes precedence over executing and broker restrictions', () => {
  assert.deepEqual(
    getCampaignRunControlState({
      ...connectedRunInput,
      isStartingCampaign: true,
      isExecutingCampaign: true,
      intersectId: null,
      selectedBrokerStatus: 'disconnected',
      hasExecutableCapability: false,
    }),
    {
      disabled: true,
      hoverInfo: 'Campaign is starting',
      showTooltipWhenDisabled: true,
    },
  )
})

test('executing state takes precedence over broker restrictions', () => {
  assert.deepEqual(
    getCampaignRunControlState({
      ...connectedRunInput,
      isExecutingCampaign: true,
      intersectId: null,
      selectedBrokerStatus: 'disconnected',
      hasExecutableCapability: false,
    }),
    {
      disabled: true,
      hoverInfo: 'Campaign is already running',
      showTooltipWhenDisabled: true,
    },
  )
})

test('broker readiness takes precedence over executable capability', () => {
  assert.deepEqual(
    getCampaignRunControlState({
      ...connectedRunInput,
      selectedBrokerStatus: 'disconnected',
      hasExecutableCapability: false,
    }),
    {
      disabled: true,
      hoverInfo:
        'The selected INTERSECT server must be connected to run this campaign',
      showTooltipWhenDisabled: true,
    },
  )
})

test('connected broker still requires an executable capability', () => {
  assert.deepEqual(
    getCampaignRunControlState({
      ...connectedRunInput,
      hasExecutableCapability: false,
    }),
    {
      disabled: true,
      hoverInfo: 'Add at least one capability node to run this campaign',
      showTooltipWhenDisabled: true,
    },
  )
})

test('whole-campaign eligibility enables Run only for executable tasks', () => {
  const campaignTask = (
    id: string,
    overrides: Partial<CampaignTask> = {},
  ): CampaignTask => ({
    id,
    hierarchy: 'capability',
    capability: 'Capability',
    operation_id: 'run',
    event_name: null,
    task_dependencies: [],
    task_objectives: null,
    ...overrides,
  })
  const campaignModel = (...tasks: CampaignTask[]): CampaignModel => ({
    id: 'campaign-1',
    run_id: 'run-1',
    name: 'Campaign',
    user: 'owner',
    description: '',
    task_groups: [
      {
        id: 'group-1',
        group_dependencies: [],
        tasks,
        objectives: [],
      },
    ],
    objectives: null,
    inputs: [],
    outputs: [],
  })
  const editorOnly = campaignModel(
    campaignTask('code', { hierarchy: 'code' }),
    campaignTask('json', { hierarchy: 'json-file' }),
  )
  const eventOnly = campaignModel(
    campaignTask('event', { operation_id: null, event_name: 'ready' }),
  )
  const mixed = campaignModel(
    campaignTask('renderer', { capability: 'Renderer' }),
    campaignTask('capability'),
  )

  assert.deepEqual(
    getCampaignRunControlState({
      ...connectedRunInput,
      hasExecutableCapability: hasExecutableCampaignTasks(editorOnly),
    }),
    {
      disabled: true,
      hoverInfo: 'Add at least one capability node to run this campaign',
      showTooltipWhenDisabled: true,
    },
  )
  for (const model of [eventOnly, mixed]) {
    assert.deepEqual(
      getCampaignRunControlState({
        ...connectedRunInput,
        hasExecutableCapability: hasExecutableCampaignTasks(model),
      }),
      {
        disabled: false,
        hoverInfo: 'Run campaign',
        showTooltipWhenDisabled: false,
      },
    )
  }
})

test('broker refresh transitions immediately update Run eligibility', () => {
  const statuses = ['disconnected', 'connected', 'disconnected']

  assert.deepEqual(
    statuses.map(
      (selectedBrokerStatus) =>
        getCampaignRunControlState({
          ...connectedRunInput,
          selectedBrokerStatus,
        }).disabled,
    ),
    [true, false, true],
  )
})

test('only the exact connected status permits campaign execution', () => {
  assert.equal(isBrokerConnected('connected'), true)

  for (const status of [
    'Connected',
    'CONNECTED',
    ' connected',
    'connected ',
    'disconnected',
    '',
    null,
    undefined,
  ]) {
    assert.equal(isBrokerConnected(status), false)
  }
})

test('normalizeStartBrokerState keeps connected status during in-flight transient gaps', () => {
  assert.deepEqual(
    normalizeStartBrokerState(
      { brokerId: '1', status: 'connected' },
      { brokerId: '1', status: undefined },
      true,
    ),
    { brokerId: '1', status: 'connected' },
  )
})

test('normalizeStartBrokerState keeps explicit disconnection updates', () => {
  assert.deepEqual(
    normalizeStartBrokerState(
      { brokerId: '1', status: 'connected' },
      { brokerId: '1', status: 'disconnected' },
      true,
    ),
    { brokerId: '1', status: 'disconnected' },
  )
})

test('normalizeStartBrokerState does not preserve status across broker switches', () => {
  assert.deepEqual(
    normalizeStartBrokerState(
      { brokerId: '1', status: 'connected' },
      { brokerId: '2', status: undefined },
      true,
    ),
    { brokerId: '2', status: undefined },
  )
})
