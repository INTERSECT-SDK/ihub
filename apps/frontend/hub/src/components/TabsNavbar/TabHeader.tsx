'use client'

import { IconFile, IconX } from '@tabler/icons-react'
import classes from './style.module.css'
import { Tab } from '@/types'
import { useTabs } from '@/hooks'
import { useParams } from 'next/navigation'
import ActiveCampaignIndicator from '../ActiveCampaignIndicator/ActiveCampaignIndicator.tsx'

interface TabsHeaderProps {
  isCampaignActive: boolean
  tabInfo: Tab
}

const LABEL_LENGTH = 15

export default function TabHeader({
  isCampaignActive,
  tabInfo,
}: TabsHeaderProps) {
  const { closeActiveTabAndNavigate, isTabTransitionPending } = useTabs()
  const params = useParams()
  const projectId = String(params.project_id)

  return (
    <div className={classes.tabHeader}>
      <div className={classes.tabIcon}>
        {tabInfo.icon ? (
          <tabInfo.icon size={20} stroke={1} />
        ) : (
          <IconFile size={20} />
        )}
      </div>
      <div className={classes.tabTitle}>
        {tabInfo.title.slice(0, LABEL_LENGTH)}
      </div>
      {isCampaignActive && <ActiveCampaignIndicator />}
      <div className={classes.tabClose}>
        <IconX
          stroke={1}
          aria-disabled={isTabTransitionPending}
          onClick={(event) => {
            // prevents onClick event for parent tab
            event.stopPropagation()
            if (!isTabTransitionPending) {
              void closeActiveTabAndNavigate(tabInfo.id, {
                title: 'Launcher',
                path: `/project/${projectId}`,
                name: 'launcher',
              })
            }
          }}
        />
      </div>
    </div>
  )
}
