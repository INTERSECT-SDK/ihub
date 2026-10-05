'use client'

import { activeNavOptionAtom, selectedProjectIdAtom } from '@/atoms/global'
import LauncherTourController from '@/components/LauncherTour'
import { getLauncherTabSelection } from '@/components/LauncherTour/launcher-tour.ts'
import { useTabs } from '@/hooks'
import { TabsNavbar } from '@/components/TabsNavbar'
import SideNavbar from '@/components/SideNavbar'
import {
  HUB_SIDE_NAVBAR_COLLAPSED_WIDTH,
  HUB_SIDE_NAVBAR_DEFAULT_OPEN_WIDTH,
  HUB_SIDE_NAVBAR_MAX_OPEN_WIDTH,
  HUB_SIDE_NAVBAR_MIN_OPEN_WIDTH,
} from '@/components/SideNavbar/side-panel-resize'
import { AppShell, Burger, Center, Loader, Stack, Text } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { useAtomValue, useSetAtom } from 'jotai'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'

import {
  clearDepartingProjectSelection,
  normalizeProjectRouteId,
} from './project-selection.ts'

function ProjectSelectionLoadingState() {
  return (
    <Center mih='40vh'>
      <Stack align='center'>
        <Loader />
        <Text>Restoring your project context...</Text>
      </Stack>
    </Center>
  )
}

export default function HubLayout({ children }: { children: React.ReactNode }) {
  const params = useParams()
  const projectId = normalizeProjectRouteId(params.project_id) ?? ''
  const selectedProjectId = useAtomValue(selectedProjectIdAtom)
  const setSelectedProjectId = useSetAtom(selectedProjectIdAtom)
  const [sidePanelWidth, setSidePanelWidth] = useState(
    HUB_SIDE_NAVBAR_DEFAULT_OPEN_WIDTH,
  )
  const activeNavOption = useAtomValue(activeNavOptionAtom)
  const [opened, { toggle }] = useDisclosure()
  const [tourReplayRequest, setTourReplayRequest] = useState(0)
  const setActiveNavOption = useSetAtom(activeNavOptionAtom)
  const { activateTab, addAndActivateTab, openTabs } = useTabs()
  const sidebarWidth = activeNavOption
    ? sidePanelWidth
    : HUB_SIDE_NAVBAR_COLLAPSED_WIDTH

  useEffect(() => {
    if (!projectId) {
      setSelectedProjectId(undefined)
      return
    }

    setSelectedProjectId(projectId)

    return () => {
      setSelectedProjectId((currentProjectId) =>
        clearDepartingProjectSelection(currentProjectId, projectId),
      )
    }
  }, [projectId, setSelectedProjectId])

  const handleTakeTour = useCallback(async () => {
    const selection = getLauncherTabSelection(openTabs, projectId, uuidv4())

    setActiveNavOption(null)
    const transitioned = selection.isNew
      ? await addAndActivateTab(selection.tab)
      : await activateTab(selection.tab)
    if (transitioned) {
      setTourReplayRequest((request) => request + 1)
    }
  }, [activateTab, addAndActivateTab, openTabs, projectId, setActiveNavOption])

  if (!projectId) {
    return <code>Invalid project path.</code>
  }

  if (selectedProjectId !== projectId) {
    return <ProjectSelectionLoadingState />
  }

  return (
    <AppShell
      padding='0'
      layout='alt'
      header={{ height: 60 }}
      navbar={{
        width: sidebarWidth,
        breakpoint: 'sm',
        collapsed: { mobile: !opened },
      }}
    >
      <AppShell.Header>
        <TabsNavbar />
        <Burger opened={opened} onClick={toggle} hiddenFrom='sm' size='xs' />
      </AppShell.Header>

      <AppShell.Navbar>
        <SideNavbar
          collapsedWidth={HUB_SIDE_NAVBAR_COLLAPSED_WIDTH}
          maxPanelWidth={HUB_SIDE_NAVBAR_MAX_OPEN_WIDTH}
          minPanelWidth={HUB_SIDE_NAVBAR_MIN_OPEN_WIDTH}
          panelWidth={sidePanelWidth}
          onPanelWidthChange={setSidePanelWidth}
          onTakeTour={handleTakeTour}
        />
      </AppShell.Navbar>

      <AppShell.Main style={{ height: '100vh' }}>{children}</AppShell.Main>
      <LauncherTourController
        projectId={projectId}
        replayRequest={tourReplayRequest}
      />
    </AppShell>
  )
}

/**
 * 
 

<div className={classes.ihubBody} style={{gridTemplateColumns: `${sidebarWidth}px 1fr`}}>
      <div className={classes.sidebar} style={{width: `${sidebarWidth}px`}}>
        <DoubleNavbar />
      </div>

      <div className={classes.topbar} style={{width: `calc(100vw - ${sidebarWidth}px)`}}>
        <TabsBar />
      </div>

        
        <div className={classes.content}>
          {children}
        </div>

    </div>


 */
