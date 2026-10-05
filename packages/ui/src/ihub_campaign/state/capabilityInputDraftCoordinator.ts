import type { CampaignModel } from '@ihub/utils/types/campaign'

// Node's focused TypeScript runner requires the imported file extension.
// @ts-expect-error TypeScript extensions are valid because this package is no-emit.
import { applyCapabilityInputDrafts } from '../model/capabilityInputDrafts.ts'
import type { CapabilityInputDraft } from '../model/capabilityInputDrafts.ts'

const CAPABILITY_INPUT_IDLE_COMMIT_MS = 1000

export type CapabilityInputDraftScope = {
  provenanceKey: string
  readOnly: boolean
}

type CapabilityInputDraftCoordinatorOptions = {
  getCampaignModel: () => CampaignModel
  persistCampaignModel: (campaignModel: CampaignModel) => void
  getScope: () => CapabilityInputDraftScope
  setTimer?: typeof setTimeout
  clearTimer?: typeof clearTimeout
}

function getDraftKey(draft: CapabilityInputDraft): string {
  return JSON.stringify([
    draft.provenanceKey,
    draft.taskGroupId,
    draft.taskId,
    draft.inputPath,
  ])
}

/** Coordinates input-local drafts and commits all pending values together. */
export class CapabilityInputDraftCoordinator {
  private readonly drafts = new Map<string, CapabilityInputDraft>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly options: CapabilityInputDraftCoordinatorOptions

  constructor(options: CapabilityInputDraftCoordinatorOptions) {
    this.options = options
  }

  stage(draft: CapabilityInputDraft): void {
    const scope = this.options.getScope()
    if (scope.readOnly || draft.provenanceKey !== scope.provenanceKey) return

    this.drafts.set(getDraftKey(draft), draft)
    this.cancelTimer()
    const schedule = this.options.setTimer ?? setTimeout
    this.timer = schedule(() => this.flush(), CAPABILITY_INPUT_IDLE_COMMIT_MS)
  }

  flush(): CampaignModel {
    this.cancelTimer()
    const campaignModel = this.options.getCampaignModel()
    if (this.drafts.size === 0) return campaignModel

    const scope = this.options.getScope()
    const drafts = [...this.drafts.values()]
    this.drafts.clear()
    const nextCampaignModel = applyCapabilityInputDrafts(
      campaignModel,
      drafts,
      {
        expectedProvenanceKey: scope.provenanceKey,
        readOnly: scope.readOnly,
      },
    )
    if (nextCampaignModel !== campaignModel) {
      this.options.persistCampaignModel(nextCampaignModel)
    }
    return nextCampaignModel
  }

  cancel(): void {
    this.cancelTimer()
    this.drafts.clear()
  }

  private cancelTimer(): void {
    if (this.timer === null) return
    const cancel = this.options.clearTimer ?? clearTimeout
    cancel(this.timer)
    this.timer = null
  }
}
