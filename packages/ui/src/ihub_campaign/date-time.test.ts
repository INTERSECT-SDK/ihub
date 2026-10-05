import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  formatLocalDateTime,
  formatLocalTime,
  parseApiDateTime,
} from '@ihub/utils/helpers/date-time'

test('parseApiDateTime treats timezone-less API datetimes as UTC', () => {
  assert.equal(
    parseApiDateTime('2026-09-01 12:30:00')?.toISOString(),
    '2026-09-01T12:30:00.000Z',
  )
})

test('local formatters use the runtime timezone', () => {
  const value = '2026-09-01T12:30:00Z'
  const date = new Date(value)
  const timeOptions: Intl.DateTimeFormatOptions = {
    hour: 'numeric',
    minute: '2-digit',
  }
  const dateTimeOptions: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }

  assert.equal(
    formatLocalTime(value, timeOptions, 'en-US'),
    new Intl.DateTimeFormat('en-US', timeOptions).format(date),
  )
  assert.equal(
    formatLocalDateTime(value, dateTimeOptions, 'en-US'),
    new Intl.DateTimeFormat('en-US', dateTimeOptions).format(date),
  )
})

test('local formatters return null for invalid timestamps', () => {
  assert.equal(formatLocalDateTime('not-a-date'), null)
})
