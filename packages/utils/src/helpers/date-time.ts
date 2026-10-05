export type DateTimeValue = string | number | Date

const EXPLICIT_TIMEZONE_PATTERN = /(?:[zZ]|[+-]\d{2}:?\d{2})$/
const DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/

/** Parses API datetimes, treating timezone-less values as UTC. */
export function parseApiDateTime(value: DateTimeValue): Date | null {
  const normalizedValue =
    typeof value === 'string' && DATE_TIME_PATTERN.test(value)
      ? `${value.replace(' ', 'T')}${EXPLICIT_TIMEZONE_PATTERN.test(value) ? '' : 'Z'}`
      : value
  const date = new Date(normalizedValue)

  return Number.isNaN(date.getTime()) ? null : date
}

/** Formats an API datetime in the user's runtime timezone. */
export function formatLocalDateTime(
  value: DateTimeValue,
  options: Intl.DateTimeFormatOptions = {
    dateStyle: 'medium',
    timeStyle: 'short',
  },
  locales?: Intl.LocalesArgument,
): string | null {
  const date = parseApiDateTime(value)
  return date ? new Intl.DateTimeFormat(locales, options).format(date) : null
}

/** Formats the date portion of an API datetime in the user's runtime timezone. */
export function formatLocalDate(
  value: DateTimeValue,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'short' },
  locales?: Intl.LocalesArgument,
): string | null {
  return formatLocalDateTime(value, options, locales)
}

/** Formats the time portion of an API datetime in the user's runtime timezone. */
export function formatLocalTime(
  value: DateTimeValue,
  options: Intl.DateTimeFormatOptions = { timeStyle: 'medium' },
  locales?: Intl.LocalesArgument,
): string | null {
  return formatLocalDateTime(value, options, locales)
}
