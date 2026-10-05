'use client'

import classes from './style.module.css'
import Tab from './Tab'
import { useTabs } from '@/hooks'
import { UnstyledButton } from '@mantine/core'
import { IconPlus } from '@tabler/icons-react'
import { useParams, usePathname } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { getInitialProjectTab } from '@/hooks/tab-state.ts'
import { useActiveCampaignFiles } from '@/hooks/useActiveCampaignFiles.ts'
import { getCampaignFileFromTab } from '@/components/SideNavbar/project-file-active-campaigns.ts'

export default function Window() {
  const { openTabs, addTab, addAndActivateTab, isTabTransitionPending } =
    useTabs()
  const pathname = usePathname()
  const params = useParams()
  const { project_id } = params
  const initializationRequested = useRef(false)
  const hasObservedOpenTabs = useRef(openTabs.length > 0)
  const projectId = String(project_id)
  const campaignFiles = useMemo(
    () =>
      openTabs.flatMap((tab) => {
        const file = getCampaignFileFromTab(tab, projectId)
        return file ? [file] : []
      }),
    [openTabs, projectId],
  )
  const activeCampaignFilePaths = useActiveCampaignFiles(campaignFiles)

  const openNewLauncherTab = useCallback(() => {
    return addAndActivateTab({
      title: 'Launcher',
      path: `/project/${projectId}`,
      name: 'launcher',
    })
  }, [addAndActivateTab, projectId])

  /* ensure there is always 1 tab */
  useEffect(() => {
    if (openTabs.length > 0) {
      hasObservedOpenTabs.current = true
      return
    }

    if (!initializationRequested.current) {
      initializationRequested.current = true
      addTab(getInitialProjectTab(pathname, projectId))
      return
    }

    if (!hasObservedOpenTabs.current) {
      return
    }

    void openNewLauncherTab()
  }, [addTab, openNewLauncherTab, openTabs, pathname, projectId])

  return (
    <div className={classes.window}>
      <div className={classes.tabList}>
        {openTabs.map((tab) => {
          const campaignFile = getCampaignFileFromTab(tab, projectId)
          return (
            <Tab
              isCampaignActive={
                campaignFile !== null &&
                activeCampaignFilePaths.includes(campaignFile.path)
              }
              tabInfo={tab}
              key={tab.id}
            />
          )
        })}
        <UnstyledButton
          key={`tab_add_new`}
          aria-label='Open Launcher tab'
          onClick={() => {
            void openNewLauncherTab()
          }}
          disabled={isTabTransitionPending}
          className={classes.addTabItem}
        >
          <IconPlus />
        </UnstyledButton>
      </div>
    </div>
  )
}
