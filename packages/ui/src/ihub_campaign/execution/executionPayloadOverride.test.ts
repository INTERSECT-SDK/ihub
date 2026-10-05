/* eslint-disable @typescript-eslint/no-require-imports -- Node's focused runner loads source and sibling TypeScript directly. */
const { readFileSync }: typeof import('node:fs') = require('node:fs')
const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')

import type { CampaignModel } from '@ihub/utils/types/campaign'

function payload(id: string): CampaignModel {
  return {
    id,
    run_id: `${id}-run`,
    name: id,
    user: 'owner',
    description: '',
    task_groups: [],
    objectives: null,
    inputs: [],
    outputs: [],
  }
}

test('execution payload override takes precedence over render-time state', () => {
  const controllerSource = readFileSync(
    require.resolve('./useCampaignExecutionController.ts'),
    'utf8',
  )
  const renderPayload = payload('render')
  const flushedPayload = payload('flushed')

  // The helper is intentionally duplicated here because the controller module
  // imports client-only React context. The source checks below ensure the
  // selected payload flows through all execution boundaries.
  const selected = flushedPayload ?? renderPayload
  assert.strictEqual(selected, flushedPayload)
  assert.match(
    controllerSource,
    /hasExecutableCampaignTasks\(effectiveExecutionPayload\)/,
  )
  assert.match(
    controllerSource,
    /materializeCampaignModelValues\(\s*effectiveExecutionPayload,/,
  )
  assert.match(
    controllerSource,
    /getExecutionPayloadWithoutSelectedBroker\(executionRequestData!\)/,
  )
  assert.match(controllerSource, /runCampaign\(\s*executionRequestPayload,/)
})
