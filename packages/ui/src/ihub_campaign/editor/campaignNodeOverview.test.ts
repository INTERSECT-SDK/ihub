/* eslint-disable @typescript-eslint/no-require-imports -- The focused Node runner loads TypeScript directly. */
const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')

const {
  deriveCampaignAllNodesGroups,
}: typeof import('./campaignNodeOverview') = require('./campaignNodeOverview.ts')

const campaignModel = {
  id: 'campaign-1',
  name: 'Campaign',
  description: '',
  user: 'user',
  run_id: '',
  objectives: null,
  inputs: [],
  outputs: [],
  task_groups: [
    {
      id: 'group-b',
      group_dependencies: [],
      objectives: [],
      tasks: [
        {
          id: 'capability',
          capability: 'Fallback capability',
          operation_id: 'calculate',
          event_name: null,
          hierarchy: 'service',
          task_dependencies: [],
          capability_metadata: { name: 'Calculator' },
        },
        {
          id: 'event',
          capability: 'Fallback event capability',
          operation_id: null,
          event_name: 'temperature.changed',
          hierarchy: 'service',
          task_dependencies: [],
        },
        {
          id: 'code',
          capability: 'Code',
          operation_id: null,
          event_name: null,
          hierarchy: 'code',
          task_dependencies: [],
          code_data: { name: 'Prepare data' },
        },
        {
          id: 'visualization',
          capability: 'Visualization',
          operation_id: 'plotly-line',
          event_name: null,
          hierarchy: 'visualization',
          task_dependencies: [],
          visualization_data: { name: 'Trend chart' },
        },
        {
          id: 'image',
          capability: 'Renderer',
          operation_id: 'image-renderer',
          event_name: null,
          hierarchy: 'renderer',
          task_dependencies: [],
          renderer_data: { name: 'Camera image', type: 'image-renderer' },
        },
        {
          id: 'text',
          capability: 'Renderer',
          operation_id: 'text-renderer',
          event_name: null,
          hierarchy: 'renderer',
          task_dependencies: [],
          renderer_data: { name: 'Summary', type: 'text-renderer' },
        },
        {
          id: 'json-file',
          capability: 'JSON File',
          operation_id: null,
          event_name: null,
          hierarchy: 'json-file',
          task_dependencies: [],
          json_file_data: { name: 'Parameters' },
        },
        {
          id: 'json-text',
          capability: 'JSON Text',
          operation_id: null,
          event_name: null,
          hierarchy: 'json-text',
          task_dependencies: [],
          json_text_data: { name: 'Inline values' },
        },
      ],
    },
    {
      id: 'group-a',
      group_dependencies: [],
      objectives: [],
      tasks: [],
    },
  ],
}

test('derives every inspector node type in canonical campaign order', () => {
  const groups = deriveCampaignAllNodesGroups(campaignModel as never)

  assert.deepEqual(
    groups.map(({ taskGroupId, label }) => ({ taskGroupId, label })),
    [
      { taskGroupId: 'group-b', label: 'Task Group 1' },
      { taskGroupId: 'group-a', label: 'Task Group 2' },
    ],
  )
  assert.deepEqual(
    groups[0]!.entries.map(({ nodeId, nodeType }) => ({ nodeId, nodeType })),
    [
      { nodeId: 'capability', nodeType: 'capability' },
      { nodeId: 'event', nodeType: 'event' },
      { nodeId: 'code', nodeType: 'code' },
      { nodeId: 'visualization', nodeType: 'visualization' },
      { nodeId: 'image', nodeType: 'image-renderer' },
      { nodeId: 'text', nodeType: 'text-renderer' },
      { nodeId: 'json-file', nodeType: 'json-file' },
      { nodeId: 'json-text', nodeType: 'json-text' },
    ],
  )
})

test('uses user-facing titles, endpoint and event subtitles, and type labels', () => {
  const entries = deriveCampaignAllNodesGroups(campaignModel as never)[0]!
    .entries

  assert.deepEqual(
    entries.map(({ title, typeLabel, subtitle }) => ({
      title,
      typeLabel,
      subtitle,
    })),
    [
      { title: 'Calculator', typeLabel: 'Capability', subtitle: 'calculate' },
      {
        title: 'Fallback event capability',
        typeLabel: 'Event',
        subtitle: 'temperature.changed',
      },
      { title: 'Prepare data', typeLabel: 'Code', subtitle: undefined },
      { title: 'Trend chart', typeLabel: 'Visualization', subtitle: undefined },
      {
        title: 'Camera image',
        typeLabel: 'Image Renderer',
        subtitle: undefined,
      },
      { title: 'Summary', typeLabel: 'Text Renderer', subtitle: undefined },
      { title: 'Parameters', typeLabel: 'JSON File', subtitle: undefined },
      { title: 'Inline values', typeLabel: 'JSON Text', subtitle: undefined },
    ],
  )
})

test('retains empty groups and handles an empty campaign', () => {
  const groups = deriveCampaignAllNodesGroups(campaignModel as never)
  assert.deepEqual(groups[1]!.entries, [])
  assert.deepEqual(
    deriveCampaignAllNodesGroups({
      ...campaignModel,
      task_groups: [],
    } as never),
    [],
  )
})
