import type { Broker } from '@ihub/utils/types/campaign'

export function shouldAutoConnectBroker(broker: Broker): boolean {
  return broker.status !== 'connected' && broker.autoConnectEnabled !== false
}
