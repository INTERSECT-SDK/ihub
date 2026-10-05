/* eslint-disable @typescript-eslint/no-require-imports -- Node's direct TS test runner needs require() for sibling TypeScript modules. */
const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')

const {
  materializeCampaignModelValues,
  materializeCampaignValues,
  materializeCodeNodeValues,
}: typeof import('./materialization') = require('./materialization.ts')
const {
  createJsonFileNodeValueResolver,
}: typeof import('../nodes/json-file/jsonFile') = require('../nodes/json-file/jsonFile.ts')

type CampaignGraphData = import('@ihub/utils/types/campaign').CampaignGraphData
type CampaignModel = import('@ihub/utils/types/campaign').CampaignModel

function makeCampaign(): CampaignGraphData {
  return {
    campaignId: 'campaign-1',
    campaignName: 'materialization.icmp',
    createdAt: '2026-07-12T00:00:00Z',
    updatedAt: '2026-07-12T00:00:00Z',
    nodes: [
      {
        id: 'code-1',
        type: 'code',
        position: { x: 0, y: 0 },
        data: {
          id: 'code-data-1',
          name: 'Notebook values',
          kernel: { id: 'kernel-1', name: 'python3' },
          server: { id: 'server-1', url: '/jupyter', token: 'secret' },
          cell: {
            id: 'cell-1',
            cell_type: 'code',
            source: 'temperature = 72',
            outputs: [],
            execution_count: 1,
            metadata: {},
          },
        },
      },
      {
        id: 'capability-1',
        type: 'capability',
        position: { x: 300, y: 0 },
        data: {
          manualInputValues: {
            mode: 'manual',
            payload: { quality: 'keep' },
          },
        },
      },
      {
        id: 'capability-2',
        type: 'capability',
        position: { x: 600, y: 0 },
        data: { manualInputValues: { untouched: true } },
      },
    ],
    edges: [
      {
        id: 'code-edge',
        source: 'code-1',
        target: 'capability-1',
        data: {
          data_mapping: [
            {
              source_parameter: 'temperature',
              target_parameter: 'payload.temperature',
            },
            { source_parameter: 'seed', target_parameter: 'seed' },
          ],
        },
      },
      {
        id: 'capability-edge',
        source: 'capability-1',
        target: 'capability-2',
        data: {
          data_mapping: [
            { source_parameter: 'result', target_parameter: 'untouched' },
          ],
        },
      },
    ],
  } as unknown as CampaignGraphData
}

test('materializes top-level and dotted code mappings without mutating the campaign', async () => {
  const campaign = makeCampaign()
  const original = structuredClone(campaign)
  const requestedParameters: string[] = []

  const result = await materializeCodeNodeValues(
    campaign,
    async (_sourceNode, sourceParameter) => {
      requestedParameters.push(sourceParameter)
      return sourceParameter === 'temperature' ? 72 : 123
    },
  )

  assert.deepEqual(requestedParameters, ['temperature', 'seed'])
  assert.notEqual(result, campaign)
  assert.deepEqual(campaign, original)
  assert.deepEqual(result.edges, campaign.edges)
  assert.deepEqual(result.nodes[0], campaign.nodes[0])
  assert.deepEqual(result.nodes[1]?.data.manualInputValues, {
    mode: 'manual',
    payload: { quality: 'keep', temperature: 72 },
    seed: 123,
  })
  assert.deepEqual(result.nodes[2]?.data.manualInputValues, { untouched: true })
})

test('folds flattened siblings into a mapped root while preserving nested values', async () => {
  const campaign = makeCampaign()
  campaign.nodes[1]!.data.manualInputValues = {
    mode: 'manual',
    payload: {
      quality: 'nested quality',
      metadata: { keep: true, priority: 'nested priority' },
    },
    'payload.quality': 'flattened quality',
    'payload.metadata.priority': 'flattened priority',
    'payload.extra': 'flattened extra',
    'payload.temperature': -1,
    'unrelated.value': 'leave flattened',
  }
  const original = structuredClone(campaign)

  const result = await materializeCodeNodeValues(
    campaign,
    async (_sourceNode, sourceParameter) =>
      sourceParameter === 'temperature' ? 72 : 123,
  )

  assert.deepEqual(campaign, original)
  assert.deepEqual(result.nodes[1]?.data.manualInputValues, {
    mode: 'manual',
    payload: {
      quality: 'flattened quality',
      metadata: { keep: true, priority: 'flattened priority' },
      extra: 'flattened extra',
      temperature: 72,
    },
    'unrelated.value': 'leave flattened',
    seed: 123,
  })
})

test('rejects unavailable values before a campaign runner can be called', async () => {
  const campaign = makeCampaign()

  for (const resolver of [
    async () => {
      throw new Error('socket unavailable')
    },
    async () => undefined,
    async () => 1n,
    async () => {
      const cyclic: Record<string, unknown> = {}
      cyclic.self = cyclic
      return cyclic
    },
  ]) {
    let runnerCalled = false

    await assert.rejects(async () => {
      const payload = await materializeCodeNodeValues(campaign, resolver)
      runnerCalled = true
      return payload
    }, /code-1\.temperature.*capability-1\.payload\.temperature/)
    assert.equal(runnerCalled, false)
  }
})

test('rejects mapped edges that reference missing nodes', async () => {
  const campaign = makeCampaign()
  campaign.edges[0] = { ...campaign.edges[0]!, source: 'missing-code' }

  await assert.rejects(
    () => materializeCodeNodeValues(campaign, async () => 1),
    /source node is missing/,
  )
})

test('normalizes reverse-horizontal mappings to the logical code source and capability target', async () => {
  const campaign = makeCampaign()
  const reverseEdge = {
    ...campaign.edges[0]!,
    source: 'capability-1',
    target: 'code-1',
    sourceHandle: 'input-left',
    targetHandle: 'output-right',
    data: {
      ...campaign.edges[0]!.data,
      horizontalDirection: 'left' as const,
    },
  }
  campaign.edges[0] = reverseEdge
  const original = structuredClone(campaign)

  const result = await materializeCodeNodeValues(
    campaign,
    async (sourceNode, sourceParameter) => {
      assert.equal(sourceNode.id, 'code-1')
      return sourceParameter === 'temperature' ? 72 : null
    },
  )

  assert.deepEqual(result.nodes[1]?.data.manualInputValues, {
    mode: 'manual',
    payload: { quality: 'keep', temperature: 72 },
    seed: null,
  })
  assert.deepEqual(result.edges[0], reverseEdge)
  assert.deepEqual(campaign, original)
})

test('preserves canonical horizontal endpoint order', async () => {
  const campaign = makeCampaign()
  campaign.edges[0] = {
    ...campaign.edges[0]!,
    sourceHandle: 'output-right',
    targetHandle: 'input-left',
  }

  const result = await materializeCodeNodeValues(campaign, async () => null)

  assert.deepEqual(result.nodes[1]?.data.manualInputValues, {
    mode: 'manual',
    payload: { quality: 'keep', temperature: null },
    seed: null,
  })
})

test('supports fully handle-less legacy mappings', async () => {
  const campaign = makeCampaign()
  campaign.edges[0] = {
    ...campaign.edges[0]!,
    sourceHandle: undefined,
    targetHandle: undefined,
  }
  const requestedParameters: string[] = []

  const result = await materializeCodeNodeValues(
    campaign,
    async (_sourceNode, sourceParameter) => {
      requestedParameters.push(sourceParameter)
      return sourceParameter === 'temperature' ? 72 : 123
    },
  )

  assert.deepEqual(requestedParameters, ['temperature', 'seed'])
  assert.deepEqual(result.nodes[1]?.data.manualInputValues, {
    mode: 'manual',
    payload: { quality: 'keep', temperature: 72 },
    seed: 123,
  })
})

test('ignores non-horizontal and partially specified mapping handles', async () => {
  const unsupportedHandlePairs = [
    ['bottom', 'top'],
    ['output-right', 'top'],
    ['output-right', undefined],
    [undefined, 'input-left'],
  ] as const

  for (const [sourceHandle, targetHandle] of unsupportedHandlePairs) {
    const campaign = makeCampaign()
    campaign.edges[0] = {
      ...campaign.edges[0]!,
      sourceHandle,
      targetHandle,
    }
    const originalInputs = structuredClone(
      campaign.nodes[1]?.data.manualInputValues,
    )
    let resolverCalls = 0

    const result = await materializeCodeNodeValues(campaign, async () => {
      resolverCalls += 1
      return 72
    })

    assert.equal(resolverCalls, 0)
    assert.deepEqual(result.nodes[1]?.data.manualInputValues, originalInputs)
  }
})

function makeJsonFileCampaign(): CampaignGraphData {
  return {
    campaignId: 'json-campaign',
    campaignName: 'json-materialization.icmp',
    createdAt: '2026-07-15T00:00:00Z',
    updatedAt: '2026-07-15T00:00:00Z',
    nodes: [
      {
        id: 'json-1',
        type: 'json-file',
        position: { x: 0, y: 0 },
        data: {
          name: 'values.json',
          fileReference: {
            projectId: 'project-1',
            path: 'inputs/values.json',
            jupyterServerId: 'server-1',
          },
          manifest: [
            {
              pointer: '/temperature',
              displayName: 'temperature',
              type: 'number',
            },
            {
              pointer: '/label',
              displayName: 'label',
              type: 'string',
            },
          ],
          contentHash: 'old-hash',
        },
      },
      {
        id: 'capability-1',
        type: 'capability',
        position: { x: 300, y: 0 },
        data: {
          endpoint_channel: {
            subscribe: {
              message: {
                payload: {
                  type: 'object',
                  properties: {
                    temperature: { title: 'Temperature', type: 'number' },
                    label: { title: 'Label', type: 'string' },
                  },
                },
              },
            },
          },
          manualInputValues: { preserved: true },
        },
      },
    ],
    edges: [
      {
        id: 'json-edge',
        source: 'json-1',
        target: 'capability-1',
        sourceHandle: 'output-right',
        targetHandle: 'input-left',
        data: {
          data_mapping: [
            {
              source_parameter: '/temperature',
              target_parameter: 'temperature',
            },
            { source_parameter: '/label', target_parameter: 'label' },
          ],
        },
      },
    ],
  } as unknown as CampaignGraphData
}

function makeCompleteCampaignModel(): CampaignModel {
  return {
    id: 'campaign-model-1',
    run_id: 'run-1',
    name: 'model-materialization.icmp',
    user: 'user-1',
    description: '',
    objectives: null,
    inputs: [],
    outputs: [],
    task_groups: [
      {
        id: 'group-1',
        group_dependencies: [],
        objectives: [],
        ui_position: { x: 10, y: 20 },
        tasks: [
          {
            id: 'code-1',
            hierarchy: 'code',
            capability: 'Code',
            operation_id: 'execute',
            task_dependencies: [],
            code_data: {
              id: 'code-data-1',
              name: 'Notebook values',
              kernel: { id: 'kernel-1', name: 'python3' },
              server: { id: 'server-1', url: '/jupyter', token: 'secret' },
              cell: {
                id: 'cell-1',
                cell_type: 'code',
                source: 'temperature = 81',
                outputs: [],
                execution_count: 1,
                metadata: {},
              },
            },
            ui_position: { x: 0, y: 0 },
          },
          {
            id: 'json-1',
            hierarchy: 'json-file',
            capability: 'JSON File',
            operation_id: 'source',
            task_dependencies: [],
            json_file_data: {
              name: 'values.json',
              fileReference: {
                projectId: 'project-1',
                path: 'inputs/values.json',
                jupyterServerId: 'server-1',
              },
              manifest: [
                {
                  pointer: '/temperature',
                  displayName: 'temperature',
                  type: 'number',
                },
              ],
            },
            ui_position: { x: 0, y: 100 },
          },
          {
            id: 'json-text-1',
            hierarchy: 'json-text',
            capability: 'JSON Text',
            operation_id: 'source',
            task_dependencies: [],
            json_text_data: {
              name: 'Inline values',
              textContent: '{"label":"inline"}',
              manifest: [
                {
                  pointer: '/label',
                  displayName: 'label',
                  type: 'string',
                },
              ],
            },
            ui_position: { x: 0, y: 200 },
          },
          {
            id: 'visualization-1',
            hierarchy: 'visualization',
            capability: 'Visualization',
            operation_id: 'plotly-line',
            task_dependencies: ['json-1'],
            manual_input_values: { __visualization_name: 'Results' },
            ui_position: { x: 300, y: 200 },
          },
          {
            id: 'renderer-1',
            hierarchy: 'renderer',
            capability: 'Renderer',
            operation_id: 'text-renderer',
            task_dependencies: ['visualization-1'],
            manual_input_values: { __renderer_name: 'Summary' },
            ui_position: { x: 600, y: 200 },
          },
          {
            id: 'capability-1',
            hierarchy: 'capability',
            capability: 'Example',
            operation_id: 'run',
            task_dependencies: ['code-1', 'json-1', 'json-text-1'],
            manual_input_values: { preserved: true },
            endpoint_channel: {
              subscribe: {
                message: {
                  payload: {
                    type: 'object',
                    properties: {
                      temperature: { title: 'Temperature', type: 'number' },
                      code_temperature: {
                        title: 'Code temperature',
                        type: 'number',
                      },
                      label: { title: 'Label', type: 'string' },
                    },
                  },
                },
              },
            },
            capability_metadata: { id: 'capability-metadata-1' },
            ui_position: { x: 300, y: 0 },
          },
          {
            id: 'event-1',
            hierarchy: 'events',
            capability: 'Example Events',
            operation_id: null,
            event_name: 'ready',
            event_mode: 'once',
            task_dependencies: ['capability-1'],
            manual_input_values: { event_setting: true },
            ui_position: { x: 600, y: 0 },
          },
        ],
        ui_edges: [
          {
            id: 'code-edge',
            source: 'code-1',
            target: 'capability-1',
            sourceHandle: 'output-right',
            targetHandle: 'input-left',
            data: {
              data_mapping: [
                {
                  source_parameter: 'temperature',
                  target_parameter: 'code_temperature',
                },
              ],
            },
          },
          {
            id: 'json-file-edge',
            source: 'json-1',
            target: 'capability-1',
            sourceHandle: 'output-right',
            targetHandle: 'input-left',
            data: {
              data_mapping: [
                {
                  source_parameter: '/temperature',
                  target_parameter: 'temperature',
                },
              ],
            },
          },
          {
            id: 'json-text-edge',
            source: 'json-text-1',
            target: 'capability-1',
            sourceHandle: 'output-right',
            targetHandle: 'input-left',
            data: {
              data_mapping: [
                {
                  source_parameter: '/label',
                  target_parameter: 'label',
                },
              ],
            },
          },
          {
            id: 'visualization-edge',
            source: 'visualization-1',
            target: 'renderer-1',
            sourceHandle: 'bottom',
            targetHandle: 'top',
            data: { isDependencyEdge: true },
          },
        ],
      },
      {
        id: 'editor-only-group',
        group_dependencies: ['group-1'],
        objectives: [],
        ui_position: { x: 800, y: 400 },
        tasks: [
          {
            id: 'visualization-only-1',
            hierarchy: 'visualization',
            capability: 'Visualization',
            operation_id: 'plotly-scatter',
            task_dependencies: ['renderer-1'],
            manual_input_values: { __visualization_name: 'Details' },
            ui_position: { x: 0, y: 0 },
          },
        ],
        ui_edges: [],
      },
    ],
  } as unknown as CampaignModel
}

test('materializes CampaignModel values while preserving the complete authored graph', async () => {
  const campaign = makeCompleteCampaignModel()
  const original = structuredClone(campaign)
  const requested: string[] = []

  const result = await materializeCampaignModelValues(campaign, {
    resolveCodeNodeValue: async (_node, parameter) => {
      requested.push(`code:${parameter}`)
      return 81
    },
    resolveJsonFileNodeValue: async (node, parameter) => {
      requested.push(`${node.type}:${parameter}`)
      return node.type === 'json-text'
        ? { value: 'inline', runtimeType: 'string' }
        : { value: 72.5, runtimeType: 'number' }
    },
  })

  assert.deepEqual(campaign, original)
  assert.deepEqual(requested, [
    'code:temperature',
    'json-file:/temperature',
    'json-text:/label',
  ])
  assert.deepEqual(
    result.task_groups.map((group) => group.id),
    ['group-1', 'editor-only-group'],
  )
  assert.deepEqual(
    result.task_groups[0]?.tasks.map((task) => task.id),
    original.task_groups[0]?.tasks.map((task) => task.id),
  )
  assert.deepEqual(
    result.task_groups[0]?.tasks.map((task) => task.task_dependencies),
    original.task_groups[0]?.tasks.map((task) => task.task_dependencies),
  )
  assert.deepEqual(
    result.task_groups[0]?.ui_edges,
    original.task_groups[0]?.ui_edges,
  )
  assert.deepEqual(
    result.task_groups.map((group) => group.group_dependencies),
    original.task_groups.map((group) => group.group_dependencies),
  )
  assert.deepEqual(result.task_groups[1], original.task_groups[1])

  const target = result.task_groups[0]?.tasks.find(
    (task) => task.id === 'capability-1',
  )
  assert.deepEqual(target?.manual_input_values, {
    preserved: true,
    temperature: 72.5,
    code_temperature: 81,
    label: 'inline',
  })

  const normalizedResult = structuredClone(result)
  normalizedResult.task_groups[0]!.tasks.find(
    (task) => task.id === 'capability-1',
  )!.manual_input_values = original.task_groups[0]!.tasks.find(
    (task) => task.id === 'capability-1',
  )!.manual_input_values
  assert.deepEqual(normalizedResult, original)
})

function makeJsonFileFetch(value: unknown, onFetch: () => void): typeof fetch {
  return (async () => {
    onFetch()
    return new Response(
      JSON.stringify({ content: JSON.stringify(value), format: 'text' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }) as typeof fetch
}

async function markJsonContentReviewed(
  campaign: CampaignGraphData,
  value: unknown,
): Promise<void> {
  const rawContent = JSON.stringify(value)
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(rawContent),
  )
  const contentHash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
  const sourceData = campaign.nodes[0]!.data as { contentHash?: string }
  sourceData.contentHash = contentHash
}

test('materializes reviewed JSON fields with one file fetch and no saved-campaign mutation', async () => {
  const campaign = makeJsonFileCampaign()
  const reviewedContent = { temperature: 72.5, label: 'reviewed value' }
  await markJsonContentReviewed(campaign, reviewedContent)
  const original = structuredClone(campaign)
  let fetchCount = 0
  const jsonResolver = createJsonFileNodeValueResolver(
    [{ id: 'server-1', url: '/jupyter', token: 'secret', label: 'Files' }],
    makeJsonFileFetch(reviewedContent, () => (fetchCount += 1)),
  )

  const result = await materializeCampaignValues(campaign, {
    resolveCodeNodeValue: async () => {
      throw new Error('code resolver should not be used')
    },
    resolveJsonFileNodeValue: jsonResolver,
  })

  assert.equal(fetchCount, 1)
  assert.deepEqual(campaign, original)
  assert.deepEqual(result.edges, campaign.edges)
  assert.deepEqual(result.nodes[1]?.data.manualInputValues, {
    preserved: true,
    temperature: 72.5,
    label: 'reviewed value',
  })
})

test('validates JSON mappings against referenced target input schemas', async () => {
  const campaign = makeJsonFileCampaign()
  const targetData = campaign.nodes[1]!.data as Record<string, unknown>
  targetData.capability = {
    endpoints_schema: {
      components: {
        schemas: {
          RandomSettings: {
            type: 'object',
            properties: {
              temperature: { title: 'Temperature', type: 'number' },
              label: { title: 'Label', type: 'string' },
            },
          },
        },
      },
    },
  }
  targetData.endpoint_channel = {
    subscribe: {
      message: {
        payload: { $ref: '#/components/schemas/RandomSettings' },
      },
    },
  }
  const reviewedContent = { temperature: 72.5, label: 'reviewed value' }
  await markJsonContentReviewed(campaign, reviewedContent)
  const jsonResolver = createJsonFileNodeValueResolver(
    [{ id: 'server-1', url: '/jupyter', token: 'secret', label: 'Files' }],
    makeJsonFileFetch(reviewedContent, () => {}),
  )

  const result = await materializeCampaignValues(campaign, {
    resolveCodeNodeValue: async () => null,
    resolveJsonFileNodeValue: jsonResolver,
  })

  assert.deepEqual(result.nodes[1]?.data.manualInputValues, {
    preserved: true,
    temperature: 72.5,
    label: 'reviewed value',
  })
})

test('materializes a whole JSON document from the empty root pointer', async () => {
  const campaign = makeJsonFileCampaign()
  const sourceData = campaign.nodes[0]!.data as {
    manifest: Array<{ pointer: string; displayName: string; type: string }>
  }
  const targetData = campaign.nodes[1]!.data as {
    endpoint_channel: {
      subscribe: {
        message: {
          payload: {
            properties: Record<
              string,
              { title: string; anyOf: Array<{ type: string }> }
            >
          }
        }
      }
    }
  }
  sourceData.manifest = [{ pointer: '', displayName: '$', type: 'object' }]
  targetData.endpoint_channel.subscribe.message.payload.properties = {
    document: { title: 'Document', anyOf: [{ type: 'object' }] },
  }
  campaign.edges[0]!.data!.data_mapping = [
    { source_parameter: '', target_parameter: 'document' },
  ]
  const document = { temperature: 72.5, nested: { enabled: true } }
  await markJsonContentReviewed(campaign, document)
  const jsonResolver = createJsonFileNodeValueResolver(
    [{ id: 'server-1', url: '/jupyter', token: 'secret', label: 'Files' }],
    makeJsonFileFetch(document, () => {}),
  )

  const result = await materializeCampaignValues(campaign, {
    resolveCodeNodeValue: async () => null,
    resolveJsonFileNodeValue: jsonResolver,
  })

  assert.deepEqual(result.nodes[1]?.data.manualInputValues, {
    preserved: true,
    document,
  })
})

test('materializes the JSON root into an open-ended object input', async () => {
  const campaign = makeJsonFileCampaign()
  const sourceData = campaign.nodes[0]!.data as {
    manifest: Array<{ pointer: string; displayName: string; type: string }>
  }
  const targetData = campaign.nodes[1]!.data as {
    endpoint_channel: {
      subscribe: {
        message: {
          payload: {
            properties: Record<string, unknown>
          }
        }
      }
    }
  }
  sourceData.manifest = [{ pointer: '', displayName: '$', type: 'object' }]
  targetData.endpoint_channel.subscribe.message.payload.properties = {
    parameters: {
      type: 'object',
      title: 'Parameters',
      additionalProperties: true,
    },
  }
  campaign.edges[0]!.data!.data_mapping = [
    { source_parameter: '', target_parameter: 'parameters' },
  ]
  const document = {
    temperature: 72.5,
    nested: { enabled: true },
  }
  await markJsonContentReviewed(campaign, document)
  const jsonResolver = createJsonFileNodeValueResolver(
    [{ id: 'server-1', url: '/jupyter', token: 'secret', label: 'Files' }],
    makeJsonFileFetch(document, () => {}),
  )

  const result = await materializeCampaignValues(campaign, {
    resolveCodeNodeValue: async () => null,
    resolveJsonFileNodeValue: jsonResolver,
  })

  assert.deepEqual(result.nodes[1]?.data.manualInputValues, {
    preserved: true,
    parameters: document,
  })
})

test('materializes a root JSON scalar from the empty root pointer', async () => {
  const campaign = makeJsonFileCampaign()
  const sourceData = campaign.nodes[0]!.data as {
    manifest: Array<{ pointer: string; displayName: string; type: string }>
  }
  sourceData.manifest = [{ pointer: '', displayName: '$', type: 'string' }]
  campaign.edges[0]!.data!.data_mapping = [
    { source_parameter: '', target_parameter: 'label' },
  ]
  await markJsonContentReviewed(campaign, 'latest root value')
  const jsonResolver = createJsonFileNodeValueResolver(
    [{ id: 'server-1', url: '/jupyter', token: 'secret', label: 'Files' }],
    makeJsonFileFetch('latest root value', () => {}),
  )

  const result = await materializeCampaignValues(campaign, {
    resolveCodeNodeValue: async () => null,
    resolveJsonFileNodeValue: jsonResolver,
  })

  assert.deepEqual(result.nodes[1]?.data.manualInputValues, {
    preserved: true,
    label: 'latest root value',
  })
})

test('blocks execution when a mapped JSON Pointer was removed', async () => {
  const campaign = makeJsonFileCampaign()
  const changedContent = { label: 'temperature removed' }
  await markJsonContentReviewed(campaign, changedContent)
  const jsonResolver = createJsonFileNodeValueResolver(
    [{ id: 'server-1', url: '/jupyter', token: 'secret', label: 'Files' }],
    makeJsonFileFetch(changedContent, () => {}),
  )

  await assert.rejects(
    () =>
      materializeCampaignValues(campaign, {
        resolveCodeNodeValue: async () => null,
        resolveJsonFileNodeValue: jsonResolver,
      }),
    /json-1\.\/temperature.*capability-1\.temperature.*JSON Pointer does not exist/,
  )
})

test('blocks execution when a mapped JSON field changes to an incompatible type', async () => {
  const campaign = makeJsonFileCampaign()
  const changedContent = { temperature: 'hot', label: 'unchanged' }
  await markJsonContentReviewed(campaign, changedContent)
  const jsonResolver = createJsonFileNodeValueResolver(
    [{ id: 'server-1', url: '/jupyter', token: 'secret', label: 'Files' }],
    makeJsonFileFetch(changedContent, () => {}),
  )

  await assert.rejects(
    () =>
      materializeCampaignValues(campaign, {
        resolveCodeNodeValue: async () => null,
        resolveJsonFileNodeValue: jsonResolver,
      }),
    /JSON value type changed to string, which is incompatible with number/,
  )
})

test('blocks execution when reviewed JSON content changes without changing mapped types', async () => {
  const campaign = makeJsonFileCampaign()
  await markJsonContentReviewed(campaign, {
    temperature: 72.5,
    label: 'reviewed value',
  })
  const jsonResolver = createJsonFileNodeValueResolver(
    [{ id: 'server-1', url: '/jupyter', token: 'secret', label: 'Files' }],
    makeJsonFileFetch({ temperature: 73.5, label: 'changed value' }, () => {}),
  )

  await assert.rejects(
    () =>
      materializeCampaignValues(campaign, {
        resolveCodeNodeValue: async () => null,
        resolveJsonFileNodeValue: jsonResolver,
      }),
    /has not been reviewed or has changed; refresh fields before running the campaign/,
  )
})

test('blocks execution when the saved JSON review hash is missing', async () => {
  const campaign = makeJsonFileCampaign()
  delete (campaign.nodes[0]!.data as { contentHash?: string }).contentHash
  const jsonResolver = createJsonFileNodeValueResolver(
    [{ id: 'server-1', url: '/jupyter', token: 'secret', label: 'Files' }],
    makeJsonFileFetch(
      { temperature: 72.5, label: 'unreviewed value' },
      () => {},
    ),
  )

  await assert.rejects(
    () =>
      materializeCampaignValues(campaign, {
        resolveCodeNodeValue: async () => null,
        resolveJsonFileNodeValue: jsonResolver,
      }),
    /has not been reviewed or has changed; refresh fields before running the campaign/,
  )
})

test('blocks execution when the referenced Jupyter server is missing', async () => {
  const campaign = makeJsonFileCampaign()
  const jsonResolver = createJsonFileNodeValueResolver([], fetch)

  await assert.rejects(
    () =>
      materializeCampaignValues(campaign, {
        resolveCodeNodeValue: async () => null,
        resolveJsonFileNodeValue: jsonResolver,
      }),
    /configured Jupyter server is unavailable/,
  )
})
