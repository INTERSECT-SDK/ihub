'use client'

import classes from './style.module.css'
import { UnstyledButton } from '@mantine/core'
import { activeTabAtom } from '@/atoms/global'
import TabHeader from './TabHeader'
import { Tab as TabT } from '@/types'
import { useAtomValue } from 'jotai'
import { useTabs } from '@/hooks'

interface TabProps {
  isCampaignActive: boolean
  tabInfo: TabT
}

export default function Tab({ isCampaignActive, tabInfo }: TabProps) {
  const activeTab = useAtomValue(activeTabAtom)
  const { activateTab, isTabTransitionPending } = useTabs()

  return (
    <UnstyledButton
      onClick={() => void activateTab(tabInfo)}
      disabled={isTabTransitionPending}
      className={classes.tabItem}
      data-active={tabInfo.id === activeTab?.id || undefined}
    >
      <TabHeader isCampaignActive={isCampaignActive} tabInfo={tabInfo} />
    </UnstyledButton>
  )
}
