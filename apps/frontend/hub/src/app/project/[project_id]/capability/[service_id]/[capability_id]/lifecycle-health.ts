import { parseApiDateTime } from '@ihub/utils/helpers/date-time'

export function formatLifecycleTimestamp(
  value: string | null,
  locales?: Intl.LocalesArgument,
  timeZone?: string,
): string {
  if (!value) {
    return 'Unavailable'
  }

  const timestamp = parseApiDateTime(value)
  if (!timestamp) {
    return 'Unavailable'
  }

  return new Intl.DateTimeFormat(locales, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
    timeZone,
  }).format(timestamp)
}
