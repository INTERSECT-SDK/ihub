/* eslint-disable @typescript-eslint/no-require-imports -- Node's focused runner loads sibling TypeScript modules directly. */
const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')
const { readFileSync }: typeof import('node:fs') = require('node:fs')

import type { CampaignModel, CampaignTask } from '@ihub/utils/types/campaign'

const { applyCapabilityInputDrafts } =
  require('./capabilityInputDrafts.ts') as typeof import('./capabilityInputDrafts')
const { CapabilityInputDraftCoordinator } =
  require('../state/capabilityInputDraftCoordinator.ts') as typeof import('../state/capabilityInputDraftCoordinator')

function task(
  id: string,
  manualInputValues: Record<string, unknown> = {},
): CampaignTask {
  return {
    id,
    hierarchy: 'capability',
    capability: 'Capability',
    operation_id: 'run',
    event_name: null,
    task_dependencies: [],
    task_objectives: null,
    manual_input_values: manualInputValues,
  }
}

function campaign(): CampaignModel {
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
          task('task-1', { keep: false, clear: 'remove me' }),
          task('task-2', { unchanged: 0 }),
        ],
        objectives: [],
      },
      {
        id: 'group-2',
        group_dependencies: [],
        tasks: [task('task-3')],
        objectives: [],
      },
    ],
    objectives: null,
    inputs: [],
    outputs: [],
  }
}

function draft(
  taskGroupId: string,
  taskId: string,
  inputPath: string,
  displayValue: string,
  provenanceKey = 'campaign:campaign-1',
) {
  return {
    provenanceKey,
    taskGroupId,
    taskId,
    inputPath,
    displayValue,
  }
}

test('applies multiple typed values and clears in one immutable model pass', () => {
  const source = campaign()
  const result = applyCapabilityInputDrafts(
    source,
    [
      draft('group-1', 'task-1', 'integer', '42'),
      draft('group-1', 'task-1', 'label', 'sample'),
      draft('group-1', 'task-1', 'clear', ''),
      draft('group-2', 'task-3', 'decimal', '1.5'),
    ],
    { expectedProvenanceKey: 'campaign:campaign-1' },
  )

  assert.deepEqual(result.task_groups[0]!.tasks[0]!.manual_input_values, {
    keep: false,
    integer: 42,
    label: 'sample',
  })
  assert.deepEqual(result.task_groups[1]!.tasks[0]!.manual_input_values, {
    decimal: 1.5,
  })
  assert.strictEqual(
    result.task_groups[0]!.tasks[1],
    source.task_groups[0]!.tasks[1],
  )
  assert.equal(
    Object.hasOwn(
      result.task_groups[0]!.tasks[0]!.manual_input_values!,
      'clear',
    ),
    false,
  )
})

test('ignores missing tasks, stale provenance, and read-only drafts', () => {
  const source = campaign()
  const drafts = [
    draft('group-1', 'missing', 'value', '1'),
    draft('group-1', 'task-1', 'value', '2', 'run:stale'),
  ]

  assert.strictEqual(
    applyCapabilityInputDrafts(source, drafts, {
      expectedProvenanceKey: 'campaign:campaign-1',
    }),
    source,
  )
  assert.strictEqual(
    applyCapabilityInputDrafts(
      source,
      [draft('group-1', 'task-1', 'value', '2')],
      {
        expectedProvenanceKey: 'campaign:campaign-1',
        readOnly: true,
      },
    ),
    source,
  )
})

test('returns the original model for parsed no-op values', () => {
  const source = campaign()
  assert.strictEqual(
    applyCapabilityInputDrafts(
      source,
      [draft('group-1', 'task-2', 'unchanged', '0')],
      { expectedProvenanceKey: 'campaign:campaign-1' },
    ),
    source,
  )
})

test('coordinator resets one idle timer and persists all drafts once', () => {
  let current = campaign()
  const persisted: CampaignModel[] = []
  let nextTimerId = 0
  const timers = new Map<number, () => void>()
  const coordinator = new CapabilityInputDraftCoordinator({
    getCampaignModel: () => current,
    persistCampaignModel: (next) => {
      current = next
      persisted.push(next)
    },
    getScope: () => ({
      provenanceKey: 'campaign:campaign-1',
      readOnly: false,
    }),
    setTimer: ((callback: () => void, delay: number) => {
      assert.equal(delay, 1000)
      nextTimerId += 1
      timers.set(nextTimerId, callback)
      return nextTimerId
    }) as typeof setTimeout,
    clearTimer: ((timerId: number) => {
      timers.delete(timerId)
    }) as typeof clearTimeout,
  })

  coordinator.stage(draft('group-1', 'task-1', 'label', 'a'))
  coordinator.stage(draft('group-1', 'task-1', 'label', 'ab'))
  coordinator.stage(draft('group-2', 'task-3', 'count', '7'))
  assert.equal(persisted.length, 0)
  assert.equal(timers.size, 1)
  ;[...timers.values()][0]!()
  assert.equal(persisted.length, 1)
  assert.equal(
    current.task_groups[0]!.tasks[0]!.manual_input_values!.label,
    'ab',
  )
  assert.equal(current.task_groups[1]!.tasks[0]!.manual_input_values!.count, 7)
  assert.strictEqual(coordinator.flush(), current)
  assert.equal(persisted.length, 1)
})

test('explicit flush commits immediately and cancels the idle callback', () => {
  let current = campaign()
  let persistenceCalls = 0
  let scheduled: (() => void) | null = null
  const coordinator = new CapabilityInputDraftCoordinator({
    getCampaignModel: () => current,
    persistCampaignModel: (next) => {
      current = next
      persistenceCalls += 1
    },
    getScope: () => ({
      provenanceKey: 'campaign:campaign-1',
      readOnly: false,
    }),
    setTimer: ((callback: () => void) => {
      scheduled = callback
      return 1
    }) as typeof setTimeout,
    clearTimer: (() => {
      scheduled = null
    }) as typeof clearTimeout,
  })

  coordinator.stage(draft('group-1', 'task-1', 'label', 'final'))
  const flushed = coordinator.flush()
  assert.strictEqual(flushed, current)
  assert.equal(persistenceCalls, 1)
  assert.equal(scheduled, null)
})

test('manual fields flush drafts on blur and Enter', () => {
  const capabilityNodeSource = readFileSync(
    require.resolve('../nodes/capability/CapabilityNode.tsx'),
    'utf8',
  )

  assert.match(capabilityNodeSource, /onBlur=\{onCommit\}/)
  assert.match(
    capabilityNodeSource,
    /onKeyDown=\{\(event\) => \{\s*if \(event\.key === 'Enter'\) onCommit\(\)/,
  )
})
