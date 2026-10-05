import type { CampaignModel } from '@ihub/utils/types/campaign'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react'

type SetDocumentContent = (
  campaignData: CampaignModel,
  options?: { dirty?: boolean },
) => void

type CampaignModelPersistence = {
  campaignModel: CampaignModel
  workingCampaignModel: CampaignModel
  setWorkingCampaignModel: Dispatch<SetStateAction<CampaignModel>>
  persistCampaignModel: (campaignModel: CampaignModel) => void
  latestCampaignModelRef: MutableRefObject<CampaignModel>
  latestPersistCampaignModelRef: MutableRefObject<
    (campaignModel: CampaignModel) => void
  >
  intersectId: string | null
  setIntersectId: Dispatch<SetStateAction<string | null>>
  alignBrokerForRecovery: (brokerId: string) => void
}

/** Produces a serializable clone without leaking React Flow runtime values. */
export function toPlainJsonValue<T>(value: T): T {
  const seen = new WeakSet<object>()

  return JSON.parse(
    JSON.stringify(value, (_key, currentValue) => {
      if (typeof currentValue === 'bigint') return currentValue.toString()
      if (currentValue instanceof Set) return [...currentValue]
      if (currentValue instanceof Map) return Object.fromEntries(currentValue)
      if (currentValue instanceof Date) return currentValue.toISOString()
      if (
        typeof currentValue === 'function' ||
        typeof currentValue === 'symbol'
      ) {
        return undefined
      }
      if (currentValue && typeof currentValue === 'object') {
        if (seen.has(currentValue)) return undefined
        seen.add(currentValue)
      }
      return currentValue
    }),
  ) as T
}

/** Returns a model whose persisted broker matches the active editor selection. */
export function withSelectedBroker(
  campaignModel: CampaignModel,
  activeBrokerId: string | null,
): CampaignModel {
  const campaignModelWithoutBroker = { ...campaignModel }
  delete campaignModelWithoutBroker.selected_broker_id

  return activeBrokerId
    ? { ...campaignModelWithoutBroker, selected_broker_id: activeBrokerId }
    : campaignModelWithoutBroker
}

export function getCampaignBrokerSelection(
  campaignModel: CampaignModel,
): string | null {
  return campaignModel.selected_broker_id != null
    ? String(campaignModel.selected_broker_id)
    : null
}

/** Owns canonical working state, dirty persistence, and broker synchronization. */
export function useCampaignModelPersistence({
  campaignData,
  historicalCampaignModel,
  isHistoricalView,
  setDocumentContent,
}: {
  campaignData: CampaignModel
  historicalCampaignModel: CampaignModel | null
  isHistoricalView: boolean
  setDocumentContent?: SetDocumentContent
}): CampaignModelPersistence {
  const [workingCampaignModel, setWorkingCampaignModel] =
    useState<CampaignModel>(campaignData)
  const campaignModel = historicalCampaignModel ?? workingCampaignModel
  const [intersectId, setIntersectId] = useState<string | null>(
    campaignData.selected_broker_id != null
      ? String(campaignData.selected_broker_id)
      : null,
  )
  const recoveredBrokerOverrideRef = useRef<string | null>(null)

  const alignBrokerForRecovery = useCallback((brokerId: string) => {
    recoveredBrokerOverrideRef.current = brokerId
    setIntersectId(brokerId)
  }, [])

  useEffect(() => {
    setWorkingCampaignModel(campaignData)
    setIntersectId(getCampaignBrokerSelection(campaignData))
  }, [campaignData])

  const persistCampaignModel = useCallback(
    (nextCampaignModel: CampaignModel) => {
      if (isHistoricalView) return
      const plainCampaignModel = toPlainJsonValue(nextCampaignModel)
      latestCampaignModelRef.current = plainCampaignModel
      setWorkingCampaignModel(plainCampaignModel)
      setDocumentContent?.(plainCampaignModel, { dirty: true })
    },
    [isHistoricalView, setDocumentContent],
  )

  const latestCampaignModelRef = useRef(campaignModel)
  const latestPersistCampaignModelRef = useRef(persistCampaignModel)
  latestCampaignModelRef.current = campaignModel
  latestPersistCampaignModelRef.current = persistCampaignModel

  useEffect(() => {
    if (isHistoricalView) return
    const persistedBrokerId = getCampaignBrokerSelection(campaignModel)
    const activeBrokerId = intersectId ? String(intersectId) : null

    if (recoveredBrokerOverrideRef.current === activeBrokerId) return
    recoveredBrokerOverrideRef.current = null
    if (persistedBrokerId === activeBrokerId) return

    persistCampaignModel(withSelectedBroker(campaignModel, activeBrokerId))
  }, [campaignModel, intersectId, isHistoricalView, persistCampaignModel])

  return {
    campaignModel,
    workingCampaignModel,
    setWorkingCampaignModel,
    persistCampaignModel,
    latestCampaignModelRef,
    latestPersistCampaignModelRef,
    intersectId,
    setIntersectId,
    alignBrokerForRecovery,
  }
}
