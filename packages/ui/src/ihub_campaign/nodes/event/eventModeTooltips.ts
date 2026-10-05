import type { CampaignEventMode } from '@ihub/utils/types/campaign'

/** Describes how each campaign event mode completes or remains active. */
export const EVENT_MODE_TOOLTIPS: Record<CampaignEventMode, string> = {
  once: 'Completes after it receives the first matching event.',
  count:
    'Remains Executing until it has received the configured number of matching events.',
  persistent:
    'Continues listening for matching events throughout the campaign. Even when a STEP_COMPLETE event is received, the status remains Executing until the campaign is complete.',
}

/** Provides the display label used for accessible event-mode controls. */
export const EVENT_MODE_LABELS: Record<CampaignEventMode, string> = {
  once: 'Once',
  count: 'Count',
  persistent: 'Persistent',
}
