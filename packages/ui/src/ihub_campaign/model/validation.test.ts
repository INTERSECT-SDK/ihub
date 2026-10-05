/* eslint-disable @typescript-eslint/no-require-imports -- Node's direct TypeScript runner loads sibling modules with require(). */
const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')

import type { CampaignModel } from '@ihub/utils/types/campaign'

const {
  validateCampaignModelReferences,
}: typeof import('./validation') = require('./validation.ts')

function validModel(): CampaignModel {
  return {
    id: 'campaign-1',
    run_id: 'run-1',
    name: 'Campaign',
    user: 'owner',
    description: '',
    task_groups: [
      {
        id: 'group-1',
        group_dependencies: [],
        tasks: [
          {
            id: 'task-1',
            hierarchy: 'capability',
            capability: 'Capability',
            operation_id: 'run',
            event_name: null,
            task_dependencies: [],
            task_objectives: null,
          },
        ],
        objectives: [],
        ui_edges: [],
      },
    ],
    objectives: null,
    inputs: [],
    outputs: [],
  }
}

test('validates canonical references without mutating valid input', () => {
  const model = validModel()
  const snapshot = structuredClone(model)
  assert.deepEqual(validateCampaignModelReferences(model), [])
  assert.deepEqual(model, snapshot)
})

test('reports duplicate, missing, and self references with stable paths', () => {
  const cases: Array<[string, (model: CampaignModel) => void]> = [
    [
      'task_groups[1].id',
      (model) => model.task_groups.push({ ...model.task_groups[0]! }),
    ],
    [
      'task_groups[0].tasks[0].task_dependencies[0]',
      (model) =>
        model.task_groups[0]!.tasks[0]!.task_dependencies.push('task-1'),
    ],
    [
      'task_groups[0].ui_edges[0]',
      (model) =>
        model.task_groups[0]!.ui_edges!.push({
          source: 'task-1',
          target: 'missing',
        }),
    ],
    [
      'task_groups[0].group_dependencies[0]',
      (model) => model.task_groups[0]!.group_dependencies.push('missing'),
    ],
    [
      'objectives.threshold[0].task_group',
      (model) => {
        model.objectives = {
          max_runtime: [],
          threshold: [
            {
              id: 'objective-1',
              type: 'range',
              var: 'value',
              target: 2,
              task_group: 'missing',
            },
          ],
        }
      },
    ],
  ]

  for (const [path, mutate] of cases) {
    const model = validModel()
    mutate(model)
    assert.equal(validateCampaignModelReferences(model)[0]?.path, path)
  }
})
