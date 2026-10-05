'use client'

import {
  Box,
  Title,
  Tooltip,
  UnstyledButton,
  Text,
  Avatar,
} from '@mantine/core'
import classes from './style.module.css'
import type { CSSProperties, PointerEvent } from 'react'
import { useCallback, useRef } from 'react'
import { Broker } from '@ihub/utils/types/campaign'
import { NavLink } from '@/types.ts'
import useSWR from 'swr'

import { useAtom, useAtomValue } from 'jotai'
import {
  jupyterServersAtom,
  activeNavOptionAtom,
  selectedProjectIdAtom,
} from '@/atoms/global.ts'

import DisplayBrokerServerStatus from './ViewBrokerServer.tsx'
import DisplayFileServerNavigator from './ViewFileServerNavigation.tsx'
import DisplayProjectFileNavigator from './ViewProjectFileNavigation.tsx'
import DisplayLLMServerStatus from './ViewLLMServerNavigation.tsx'
import DisplayJupyterServerStatus from './ViewJupyterServerStatus.tsx'
import DisplayCapabilityStore from './ViewCapabilityStore.tsx'
import DisplaySettings from './ViewSettings.tsx'

import {
  IHubIconActiveExperiment,
  IHubIconAgent,
  IHubIconFolder,
  IHubIconIntersect,
  IHubIconJupyter,
  IHubIconLLMServer,
  IHubIconMCP,
  IHubIconNotification,
  IHubIconSettings,
} from '@ihub/utils/icons'

import Link from 'next/link'
import { useSession } from '@/app/providers/SessionProvider.tsx'

import DisplayMCPServerStatus from './ViewMCPServer.tsx'
import { MCPServer } from '@ihub/utils/types/campaign'
import DisplayAgents from './ViewAgents.tsx'
import DisplayActiveExperiments from './ViewActiveExperiments.tsx'
import { getSidePanelResizeWidth } from './side-panel-resize.ts'

// TEST: TODO fetch server info from database or json files, and initiate connections to them
// TODO: we need to think about what kinds of servers we will connect to.
// So far I am thinking: file servers, db servers, brokers, virtual machines, jupyter servers

const listIconSize = 22
const listIconStroke = 1.5
const serverTypesAndIcons = {
  broker: (
    <IHubIconIntersect
      height={listIconSize}
      width={listIconSize}
      stroke={listIconStroke}
      color='dimgray'
    />
  ),
  jupyter: <IHubIconJupyter size={listIconSize} stroke={1} />,
  file_server: (
    <IHubIconFolder
      height={listIconSize}
      width={listIconSize}
      stroke={listIconStroke}
      color='dimgray'
    />
  ),
  mcp_server: (
    <IHubIconMCP height={listIconSize} width={listIconSize} color='dimgray' />
  ),
  llm_server: (
    <IHubIconLLMServer
      height={listIconSize}
      width={listIconSize}
      stroke={listIconStroke}
      color='dimgray'
    />
  ),
}

const resizeHandleWidth = 8

type ResizeState = {
  pointerStartX: number
  panelStartWidth: number
}

type SideNavbarProps = {
  collapsedWidth: number
  minPanelWidth: number
  maxPanelWidth: number
  panelWidth: number
  onPanelWidthChange: (width: number) => void
  onTakeTour: () => void
}

type SideNavbarStyle = CSSProperties &
  Record<
    | '--hub-side-navbar-collapsed-width'
    | '--hub-side-navbar-resize-handle-width',
    string
  >

/**
 * Loads the broker servers available to the current navbar context.
 *
 * @param url - API endpoint scoped to the selected project when available.
 * @returns Broker server records used by the broker status panel.
 */
const fetchBrokers = async (url: string): Promise<Broker[]> => {
  const response = await fetch(url)
  const brokers = await response.json()
  return brokers as Broker[]
}

/**
 * Loads the MCP servers available to the current navbar context.
 *
 * @param url - API endpoint scoped to the selected project when available.
 * @returns MCP server records used by the MCP status panel.
 */
const fetchMCPServers = async (url: string): Promise<MCPServer[]> => {
  const response = await fetch(url)
  const mcpServers = await response.json()
  return mcpServers as MCPServer[]
}

/**
 * I have devided the main links into three categories:
 * L1 (top group) are the views such as campaigns, notebooks, visualizations, etc
 * L2 (middle group) are the server connections of different type
 * L3 (buttom group) is the store
 *
 * at the very end, we have ihub settings and account
 */

const mainLinksL1: NavLink[] = [
  {
    icon: IHubIconFolder,
    name: 'project-files',
    label: 'Project Files',
  },
  // {
  //   icon: IHubIconFolders,
  //   name: 'file-servers',
  //   label: 'File Servers',
  // },
  // {
  //   icon: IconBox,
  //   name: 'capability-store',
  //   label: 'Capability Store',
  // },
]

const mainLinksL2: NavLink[] = [
  {
    icon: IHubIconNotification,
    name: 'notifications',
    label: 'Notifications',
  },
  {
    icon: IHubIconActiveExperiment,
    name: 'active-experiments',
    label: 'Active Experiments',
  },
]

const mainLinksL3: NavLink[] = [
  {
    icon: IHubIconIntersect,
    name: 'broker-servers',
    label: 'INTERSECT Servers',
  },
  {
    icon: IHubIconAgent,
    name: 'agents-list',
    label: 'Agents',
  },
  {
    icon: IHubIconLLMServer,
    name: 'llm-servers',
    label: 'LLM Servers',
  },
  {
    icon: IHubIconMCP,
    name: 'mcp-servers',
    label: 'MCP Servers',
  },
  {
    icon: IHubIconJupyter,
    name: 'jupyter-servers',
    label: 'Jupyter Servers',
  },
]

/**
 * Renders the hub side navigation rail and the active side panel.
 *
 * The component owns the selected navigation option, lazy-loads server data for
 * panels that need it, and coordinates pointer-based resizing of the expanded
 * side panel.
 *
 * @param props - Width constraints and resize callback supplied by the hub layout.
 * @returns The collapsed icon rail plus the active panel and resize handle.
 */
export default function SideNavbar({
  collapsedWidth,
  minPanelWidth,
  maxPanelWidth,
  panelWidth,
  onPanelWidthChange,
  onTakeTour,
}: SideNavbarProps) {
  const [active, setActive] = useAtom<NavLink | null>(activeNavOptionAtom)
  const resizeStateRef = useRef<ResizeState | null>(null)
  const selectedProjectId = useAtomValue(selectedProjectIdAtom)

  const jupyterServers = useAtomValue(jupyterServersAtom)
  const brokersUrl = selectedProjectId
    ? `/api/v1/brokers?project_id=${selectedProjectId}`
    : '/api/v1/brokers'
  const mcpServersUrl = selectedProjectId
    ? `/api/v1/mcp_servers?project_id=${selectedProjectId}`
    : '/api/v1/mcp_servers'

  const { session: session } = useSession()
  const bottomLinks: NavLink[] = [
    { icon: IHubIconSettings, name: 'ihub-settings', label: 'iHub Settings' },
    {
      icon: () => (
        <Avatar color='blue' size={22}>
          {session?.user?.firstName?.[0]}
          {session?.user?.lastName?.[0]}
        </Avatar>
      ),
      name: 'account',
      label: 'Account',
    },
  ]

  /* fetch brokers from database */
  const { data: brokers } = useSWR<Broker[]>(
    active?.name === 'broker-servers' ? brokersUrl : null,
    fetchBrokers,
    {
      revalidateOnFocus: true,
      revalidateIfStale: true,
    },
  )

  /* fetch mcpServers from database */
  const { data: mcpServers } = useSWR<MCPServer[]>(
    active?.name === 'mcp-servers' ? mcpServersUrl : null,
    fetchMCPServers,
    {
      revalidateOnFocus: true,
      revalidateIfStale: true,
    },
  )

  /**
   * Starts a resize gesture for the expanded side panel.
   *
   * @param event - Pointer event from the resize handle.
   */
  const handleResizePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!active) {
        return
      }

      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      resizeStateRef.current = {
        pointerStartX: event.clientX,
        panelStartWidth: panelWidth,
      }
    },
    [active, panelWidth],
  )

  /**
   * Applies pointer movement to the panel width while honoring layout bounds.
   *
   * Attempted widths outside the configured bounds are clamped before the
   * accepted width is sent to the parent layout.
   *
   * @param event - Pointer movement event from the resize handle.
   */
  const handleResizePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!resizeStateRef.current) {
        return
      }

      event.preventDefault()
      const attemptedWidth =
        resizeStateRef.current.panelStartWidth +
        event.clientX -
        resizeStateRef.current.pointerStartX
      const clampedWidth = getSidePanelResizeWidth(attemptedWidth, {
        maxWidth: maxPanelWidth,
        minWidth: minPanelWidth,
      })

      onPanelWidthChange(clampedWidth)
    },
    [maxPanelWidth, minPanelWidth, onPanelWidthChange],
  )

  /**
   * Ends an active resize gesture and releases pointer capture when needed.
   *
   * @param event - Pointer completion or cancellation event from the resize handle.
   */
  const stopResize = useCallback((event: PointerEvent<HTMLDivElement>) => {
    resizeStateRef.current = null

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }, [])

  const navbarStyle: SideNavbarStyle = {
    '--hub-side-navbar-collapsed-width': `${collapsedWidth}px`,
    '--hub-side-navbar-resize-handle-width': `${resizeHandleWidth}px`,
  }

  const MainLinks1 = mainLinksL1.map((link) => (
    <Tooltip
      label={link.label}
      position='right'
      withArrow
      transitionProps={{ duration: 0 }}
      key={link.label}
    >
      <UnstyledButton
        aria-label={link.label}
        onClick={() => {
          if (active?.name !== link.name) {
            setActive(link)
          } else {
            setActive(null)
          }
          // router.push('/hub')
        }}
        className={classes.mainLink}
        data-active={link.name === active?.name || undefined}
      >
        <link.icon size={22} stroke={1.5} />
      </UnstyledButton>
    </Tooltip>
  ))

  const MainLinks2 = mainLinksL2.map((link) => (
    <Tooltip
      label={link.label}
      position='right'
      withArrow
      transitionProps={{ duration: 0 }}
      key={link.label}
    >
      <UnstyledButton
        aria-label={link.label}
        onClick={() => {
          if (active?.name !== link.name) {
            setActive(link)
          } else {
            setActive(null)
          }
          // router.push('/hub')
        }}
        className={classes.mainLink}
        data-active={link.name === active?.name || undefined}
      >
        <link.icon size={22} stroke={1.5} />
      </UnstyledButton>
    </Tooltip>
  ))

  const MainLinks3 = mainLinksL3.map((link) => (
    <Tooltip
      label={link.label}
      position='right'
      withArrow
      transitionProps={{ duration: 0 }}
      key={link.label}
    >
      <UnstyledButton
        aria-label={link.label}
        onClick={() => {
          if (active?.name !== link.name) {
            setActive(link)
          } else {
            setActive(null)
          }
        }}
        className={classes.mainLink}
        data-active={link.name === active?.name || undefined}
      >
        <link.icon size={22} stroke={1.5} />
      </UnstyledButton>
    </Tooltip>
  ))

  const BottomLinks = bottomLinks.map((link) => (
    <Tooltip
      label={link.label}
      position='right'
      withArrow
      transitionProps={{ duration: 0 }}
      key={link.label}
    >
      <UnstyledButton
        aria-label={link.label}
        onClick={() => {
          console.log('clicking bottom link', active === link, link, active)
          if (active?.name !== link.name) {
            setActive(link)
          } else {
            setActive(null)
          }
        }}
        className={classes.mainLink}
        data-active={link.name === active?.name || undefined}
      >
        <link.icon size={22} stroke={1.5} />
      </UnstyledButton>
    </Tooltip>
  ))

  return (
    <nav className={classes.navbar} style={navbarStyle}>
      <div className={classes.wrapper}>
        <div className={classes.aside}>
          <Tooltip
            label='Return to project selection.'
            position='right'
            withArrow
            transitionProps={{ duration: 0 }}
          >
            <Link
              href={'/'}
              className={classes.logo}
              data-tour='nav-project-selection'
            >
              iHub
            </Link>
          </Tooltip>
          <Text size='xs'>v{process.env.NEXT_PUBLIC_VERSION}</Text>

          <Box mt='xl' data-tour='nav-project-activity'>
            {MainLinks1}
            <hr className='my-2' />
            {MainLinks2}
          </Box>
          <Box data-tour='nav-connections'>
            <hr className='my-2' />
            {MainLinks3}
          </Box>

          <Box mt={'auto'} data-tour='nav-utilities'>
            {BottomLinks}
          </Box>
        </div>
        {active && (
          <div className={classes.main}>
            <div className={classes.mainHeader}>
              <Title order={4} className={classes.title}>
                {active?.label}
              </Title>
            </div>

            <div className={classes.mainContent}>
              {/* only show store when store link is active */}
              {active?.name === 'capability-store' && (
                <DisplayCapabilityStore />
              )}
              {active?.name === 'ihub-settings' && <DisplaySettings />}
              {active?.name === 'active-experiments' && (
                <DisplayActiveExperiments />
              )}
              {active?.name === 'project-files' && (
                <DisplayProjectFileNavigator servers={jupyterServers} />
              )}
              {active?.name === 'file-servers' && (
                <DisplayFileServerNavigator
                  servers={jupyterServers}
                  icon={serverTypesAndIcons['file_server']}
                />
              )}
              {active?.name === 'broker-servers' && brokers && (
                <DisplayBrokerServerStatus
                  brokers={brokers}
                  icon={serverTypesAndIcons['broker']}
                />
              )}
              {active?.name === 'mcp-servers' && mcpServers && (
                <DisplayMCPServerStatus
                  mcp_servers={mcpServers}
                  icon={serverTypesAndIcons['mcp_server']}
                />
              )}
              {active?.name === 'jupyter-servers' && (
                <DisplayJupyterServerStatus
                  servers={jupyterServers}
                  icon={serverTypesAndIcons['jupyter']}
                />
              )}
              {active?.name === 'llm-servers' && (
                <DisplayLLMServerStatus
                  icon={serverTypesAndIcons['llm_server']}
                />
              )}
              {active?.name === 'agents-list' && <DisplayAgents />}
              {active?.name === 'account' && (
                <UnstyledButton
                  className={classes.accountAction}
                  onClick={onTakeTour}
                >
                  Take a tour
                </UnstyledButton>
              )}
            </div>
          </div>
        )}
        {active && (
          <div
            aria-hidden='true'
            className={classes.resizeHandle}
            onPointerCancel={stopResize}
            onPointerDown={handleResizePointerDown}
            onPointerMove={handleResizePointerMove}
            onPointerUp={stopResize}
          />
        )}
      </div>
    </nav>
  )
}
