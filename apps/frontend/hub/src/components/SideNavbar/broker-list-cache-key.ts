const BROKER_LIST_PATH = '/api/v1/brokers'

/** Returns whether an SWR key identifies a broker-list request. */
export function isBrokerListCacheKey(key: unknown): boolean {
  return (
    typeof key === 'string' &&
    (key === BROKER_LIST_PATH || key.startsWith(`${BROKER_LIST_PATH}?`))
  )
}
