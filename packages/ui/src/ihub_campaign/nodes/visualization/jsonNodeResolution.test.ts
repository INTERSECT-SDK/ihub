/* eslint-disable @typescript-eslint/no-require-imports -- Node's direct TS runner needs require() for sibling modules. */
import type { CampaignNode } from '@ihub/utils/types/campaign'

const { test }: typeof import('node:test') = require('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')

const {
  resolveJsonNodeMappingValue,
}: typeof import('./jsonNodeResolution') = require('./jsonNodeResolution.ts')

test('resolves JSON Text values with their selected JSON Pointer', async () => {
  const sourceNode: CampaignNode = {
    id: 'json-text-1',
    type: 'json-text',
    position: { x: 0, y: 0 },
    data: {
      name: 'JSON Text',
      textContent: '{"temperature":21}',
      manifest: [],
    },
  }

  const value = await resolveJsonNodeMappingValue(sourceNode, '/temperature', {
    resolveJsonFileNodeValue: async () => {
      throw new Error('unexpected JSON File resolver call')
    },
    resolveJsonTextNodeValue: async (_node, sourcePath) => ({
      value: sourcePath === '/temperature' ? 21 : undefined,
      runtimeType: 'integer',
    }),
  })

  assert.equal(value, 21)
})

test('resolves a JSON File root value with an empty JSON Pointer', async () => {
  const sourceNode: CampaignNode = {
    id: 'json-file-1',
    type: 'json-file',
    position: { x: 0, y: 0 },
    data: {
      name: 'values.json',
      manifest: [],
    },
  }
  const rootValue = { enabled: true }

  const value = await resolveJsonNodeMappingValue(sourceNode, '', {
    resolveJsonFileNodeValue: async (_node, sourcePath) => {
      assert.equal(sourcePath, '')
      return { value: rootValue, runtimeType: 'object' }
    },
    resolveJsonTextNodeValue: async () => {
      throw new Error('unexpected JSON Text resolver call')
    },
  })

  assert.deepEqual(value, rootValue)
})
