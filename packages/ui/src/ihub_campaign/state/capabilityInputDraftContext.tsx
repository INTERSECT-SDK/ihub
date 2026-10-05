import type { CampaignModel } from '@ihub/utils/types/campaign'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type MutableRefObject,
  type ReactNode,
} from 'react'

import type { CapabilityInputDraft } from '../model/capabilityInputDrafts'
import { CapabilityInputDraftCoordinator } from './capabilityInputDraftCoordinator'

type CapabilityInputDraftContextValue = {
  taskGroupId: string | null
  stageCapabilityInputDraft: (
    draft: Omit<CapabilityInputDraft, 'taskGroupId'>,
  ) => void
  flushCapabilityInputDrafts: () => CampaignModel
}

const CapabilityInputDraftContext =
  createContext<CapabilityInputDraftContextValue | null>(null)

export function useCapabilityInputDraftCoordinator({
  latestCampaignModelRef,
  persistCampaignModel,
  provenanceKey,
  readOnly,
  taskGroupId,
}: {
  latestCampaignModelRef: MutableRefObject<CampaignModel>
  persistCampaignModel: (campaignModel: CampaignModel) => void
  provenanceKey: string
  readOnly: boolean
  taskGroupId: string | null
}) {
  const persistRef = useRef(persistCampaignModel)
  persistRef.current = persistCampaignModel
  const scopeRef = useRef({ provenanceKey, readOnly })
  scopeRef.current = { provenanceKey, readOnly }
  const coordinatorRef = useRef<CapabilityInputDraftCoordinator | null>(null)
  coordinatorRef.current ??= new CapabilityInputDraftCoordinator({
    getCampaignModel: () => latestCampaignModelRef.current,
    persistCampaignModel: (model) => persistRef.current(model),
    getScope: () => scopeRef.current,
  })

  useEffect(
    () => () => {
      coordinatorRef.current?.flush()
    },
    [],
  )

  const flushCapabilityInputDrafts = useCallback(
    () => coordinatorRef.current!.flush(),
    [],
  )
  const stageCapabilityInputDraft = useCallback(
    (draft: Omit<CapabilityInputDraft, 'taskGroupId'>) => {
      if (!taskGroupId) return
      coordinatorRef.current!.stage({ ...draft, taskGroupId })
    },
    [taskGroupId],
  )
  const contextValue = useMemo(
    () => ({
      taskGroupId,
      stageCapabilityInputDraft,
      flushCapabilityInputDrafts,
    }),
    [flushCapabilityInputDrafts, stageCapabilityInputDraft, taskGroupId],
  )

  return { contextValue, flushCapabilityInputDrafts }
}

export function CapabilityInputDraftProvider({
  value,
  children,
}: {
  value: CapabilityInputDraftContextValue
  children: ReactNode
}) {
  return (
    <CapabilityInputDraftContext.Provider value={value}>
      {children}
    </CapabilityInputDraftContext.Provider>
  )
}

export function useCapabilityInputDrafts(): CapabilityInputDraftContextValue {
  const context = useContext(CapabilityInputDraftContext)
  if (!context) {
    throw new Error(
      'useCapabilityInputDrafts must be used within CapabilityInputDraftProvider',
    )
  }
  return context
}
