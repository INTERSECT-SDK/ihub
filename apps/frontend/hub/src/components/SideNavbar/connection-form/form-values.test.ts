import assert from 'node:assert/strict'
import test from 'node:test'

import type { FieldDef } from '@ihub/utils/types/types'

import {
  buildInitialValues,
  buildSubmitValues,
  getNestedValue,
  mapFetchedFieldOptions,
  setNestedValue,
} from './form-values.ts'

test('creates and reads nested values', () => {
  const values = setNestedValue({}, 'auth.headers.token', 'secret-token')

  assert.deepEqual(values, {
    auth: {
      headers: {
        token: 'secret-token',
      },
    },
  })
  assert.equal(getNestedValue(values, 'auth.headers.token'), 'secret-token')
})

test('omits blank password and secret fields on edit', () => {
  const fields: FieldDef[] = [
    { name: 'label', type: 'text' },
    { name: 'password', type: 'password' },
    { name: 'auth.api_key', type: 'text' },
    { name: 'metadata.secret', type: 'text' },
  ]

  assert.deepEqual(
    buildSubmitValues(
      fields,
      {
        label: 'Broker',
        password: '',
        auth: {
          api_key: '',
        },
        metadata: {
          secret: '',
        },
      },
      true,
    ),
    {
      label: 'Broker',
    },
  )
})

test('maps switch values for boolean and configured field values', () => {
  const fields: FieldDef[] = [
    {
      name: 'enabled',
      type: 'switch',
      checkedValue: 'on',
      uncheckedValue: 'off',
    },
  ]

  assert.deepEqual(buildSubmitValues(fields, { enabled: true }), {
    enabled: 'on',
  })
  assert.deepEqual(buildSubmitValues(fields, { enabled: 'off' }), {
    enabled: 'off',
  })
})

test('normalizes fetched select and multiselect identifiers', () => {
  const fields: FieldDef[] = [
    { name: 'broker_id', type: 'select', fetchUrl: '/api/v1/brokers' },
    { name: 'tool_ids', type: 'multiselect', fetchUrl: '/api/v1/tools' },
  ]

  assert.deepEqual(
    buildInitialValues(fields, {
      broker_id: 12,
      tool_ids: [1, '2'],
    }),
    {
      broker_id: '12',
      tool_ids: ['1', '2'],
    },
  )
  assert.deepEqual(
    mapFetchedFieldOptions(fields[0], [{ id: 12, label: 'Broker' }]),
    [{ label: 'Broker', value: '12' }],
  )
  assert.deepEqual(
    mapFetchedFieldOptions(fields[1], [
      { id: 1, mcp_server_id: 3, tool_name: 'search' },
    ]),
    [
      {
        id: '1',
        mcp_server_id: 3,
        mcp_server_label: undefined,
        tool_name: 'search',
      },
    ],
  )
})
