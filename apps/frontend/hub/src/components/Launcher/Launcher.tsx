'use client'

import {
  Badge,
  Blockquote,
  Card,
  Group,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
} from '@mantine/core'
import classes from './launcher.module.css'
import { useAtomValue } from 'jotai'
import { activeTabAtom, jupyterServersAtom } from '@/atoms/global.ts'
import { useTabs } from '@/hooks/index.ts'
import { v4 as uuidv4 } from 'uuid'
import { useParams } from 'next/navigation.js'
import { useRef, useState } from 'react'
import type { LauncherCapability } from '@/types.ts'
import { IHubIconCube, IHubIconSearch } from '@ihub/utils/icons'
import {
  buildJupyterContentsUrl,
  buildProjectFileRoute,
} from '@/app/project/project-file-path.ts'
import {
  getNextProjectFileName,
  getProjectListingNames,
} from './project-file-name.ts'
import { getStatusBadgeColor } from '../status-badge.ts'
import {
  DiscoveredLauncherCapability,
  LauncherCapabilityStatus,
  useLauncherCapabilities,
} from './useLauncherCapabilities.ts'
import { getCapabilityStatusTooltip } from './lifecycle-health.ts'
import { groupLauncherCapabilitiesByBroker } from './launcher-capability-groups.ts'

const CAPABILITY_LABEL_LIMIT = 15

function getStatusBadge(status: LauncherCapabilityStatus): {
  label: string
  color: string
} {
  if (status === 'error') {
    return {
      label: 'Error',
      color: getStatusBadgeColor(status),
    }
  }

  if (status === 'offline') {
    return {
      label: 'Offline',
      color: getStatusBadgeColor(status),
    }
  }

  if (status === 'stale') {
    return {
      label: 'Stale',
      color: getStatusBadgeColor(status),
    }
  }

  return {
    label: 'Online',
    color: getStatusBadgeColor(status),
  }
}

export default function Launcher() {
  const activeTab = useAtomValue(activeTabAtom)
  const jupyterServers = useAtomValue(jupyterServersAtom)
  const capabilitiesList = useLauncherCapabilities()
  const [capabilitySearch, setCapabilitySearch] = useState('')
  const [creationError, setCreationError] = useState<string | null>(null)
  const [isCreatingDocument, setIsCreatingDocument] = useState(false)
  const creationInFlightRef = useRef(false)
  const { addAndActivateTab, replaceAndActivateTab } = useTabs()
  const params = useParams()

  const { project_id } = params

  const iconSize = 36
  const iconStroke = 1.5

  const selectLauncherApp = async (
    tabId: number | string,
    selectedApp: LauncherCapability,
  ) => {
    if (creationInFlightRef.current) {
      return
    }

    const projectId = String(project_id)
    const jupyterServer = jupyterServers[0]
    const extension = selectedApp.file_extension

    if (!extension || !jupyterServer) {
      setCreationError('A connected Jupyter server is required.')
      return
    }

    creationInFlightRef.current = true
    setIsCreatingDocument(true)
    setCreationError(null)

    try {
      const response = await fetch(
        buildJupyterContentsUrl(jupyterServer.url, `projects/${projectId}`),
        {
          headers: {
            Authorization: `Bearer ${jupyterServer.token}`,
            'Cache-Control': 'no-cache',
            Pragma: 'no-cache',
          },
        },
      )
      if (!response.ok && response.status !== 404) {
        throw new Error(`Project file listing failed with ${response.status}.`)
      }

      const existingNames =
        response.status === 404
          ? []
          : getProjectListingNames(await response.json())
      const path = getNextProjectFileName(
        existingNames,
        selectedApp.label,
        extension,
      )
      const name = path.slice(0, -(extension.length + 1))
      const fileRoute = buildProjectFileRoute(projectId, path)
      const createRoute = `${fileRoute}?create=1`

      const newTab = {
        id: uuidv4(),
        title: name,
        path: fileRoute,
        icon: selectedApp.icon,
      }

      await replaceAndActivateTab(tabId, newTab, createRoute)
    } catch (error) {
      console.error('Failed to choose a new project filename:', error)
      setCreationError(
        'Unable to create a uniquely named document. Please try again.',
      )
    } finally {
      creationInFlightRef.current = false
      setIsCreatingDocument(false)
    }
  }

  const openCapabilityDetailsTab = (
    capability: DiscoveredLauncherCapability,
  ) => {
    const tabId = uuidv4()
    const route = `/project/${encodeURIComponent(String(project_id))}/capability/${capability.serviceId}/${encodeURIComponent(capability.capabilityName)}`

    void addAndActivateTab({
      id: tabId,
      title: capability.label,
      name: `capability-${capability.serviceId}-${capability.capabilityName}`,
      path: route,
      icon: capability.icon,
    })
  }

  const renderCapability = (
    cap: LauncherCapability,
    groupName: string,
    isBrowseCapability: boolean,
  ) => {
    const browseCapability = cap as DiscoveredLauncherCapability
    const capabilityStatus = isBrowseCapability ? browseCapability.status : null
    const statusBadge = capabilityStatus
      ? getStatusBadge(capabilityStatus)
      : null
    const isCreationDisabled = !isBrowseCapability && isCreatingDocument
    const isDisabled = isCreationDisabled
    const disabledTooltip = 'Creating document...'
    const statusTooltip = isBrowseCapability
      ? getCapabilityStatusTooltip(
          capabilityStatus as LauncherCapabilityStatus,
          browseCapability.lifecycleError,
        )
      : undefined
    const isCapabilityLabelTruncated =
      isBrowseCapability && cap.label.length > CAPABILITY_LABEL_LIMIT
    const browseCapabilityTooltipLines = isCapabilityLabelTruncated
      ? [cap.label, ...(statusTooltip ? [statusTooltip] : [])]
      : statusTooltip
        ? [statusTooltip]
        : []
    const capabilityTooltip = isBrowseCapability
      ? browseCapabilityTooltipLines.length > 0
        ? browseCapabilityTooltipLines.map((line, index) => (
            <div data-launcher-tooltip-line key={`${index}-${line}`}>
              {line}
            </div>
          ))
        : undefined
      : cap.tooltip

    return (
      <Tooltip
        label={isDisabled ? disabledTooltip : capabilityTooltip}
        disabled={!isDisabled && !capabilityTooltip}
        multiline={isBrowseCapability}
        maw={isBrowseCapability ? 320 : undefined}
        key={`launcher-cap-${groupName}-${cap.name}`}
      >
        <span>
          <UnstyledButton
            h='100px'
            w='110px'
            p='xs'
            className={classes.item}
            disabled={isDisabled}
            data-disabled={isDisabled || undefined}
            data-capability-id={isBrowseCapability ? cap.name : undefined}
            onClick={
              isBrowseCapability
                ? () => {
                    if (!isDisabled) {
                      openCapabilityDetailsTab(browseCapability)
                    }
                  }
                : () => {
                    if (!isDisabled) {
                      void selectLauncherApp(activeTab?.id ?? '', cap)
                    }
                  }
            }
          >
            {statusBadge && (
              <Badge
                className={classes.statusBadge}
                variant='filled'
                radius='xl'
                color={statusBadge.color}
              >
                {statusBadge.label}
              </Badge>
            )}

            {cap.icon ? (
              <cap.icon size={iconSize} stroke={iconStroke} />
            ) : (
              <IHubIconCube size={iconSize} stroke={iconStroke} />
            )}

            <Text size='xs' mt={7}>
              {cap.label.substring(0, CAPABILITY_LABEL_LIMIT)}
            </Text>
          </UnstyledButton>
        </span>
      </Tooltip>
    )
  }

  return (
    <div>
      {creationError && (
        <Blockquote mx={50} color='red' mt='xl' mb='md' py='xs'>
          {creationError}
        </Blockquote>
      )}
      {capabilitiesList.map((group) => {
        const isBrowseCapabilityGroup =
          group.groupName === 'Browse capabilities'

        const filteredCapabilities = isBrowseCapabilityGroup
          ? group.capabilities.filter((cap) =>
              cap.label
                .toLowerCase()
                .includes(capabilitySearch.trim().toLowerCase()),
            )
          : group.capabilities
        const brokerGroups = isBrowseCapabilityGroup
          ? groupLauncherCapabilitiesByBroker(
              filteredCapabilities as DiscoveredLauncherCapability[],
            )
          : []

        return (
          <Card
            withBorder
            radius='md'
            className={classes.card}
            key={`launcher_group_${group.groupName}`}
            data-tour={
              group.groupName === 'Create a document'
                ? 'launcher-create'
                : isBrowseCapabilityGroup
                  ? 'launcher'
                  : undefined
            }
          >
            <Group justify='space-between'>
              <Text className={classes.title}>{group.groupName}</Text>

              <Text
                className={classes.groupCount}
                size='xs'
                c='dimmed'
                style={{ lineHeight: 1 }}
              >
                {isBrowseCapabilityGroup
                  ? `${filteredCapabilities.length} of ${group.capabilities.length}`
                  : group.capabilities.length}{' '}
                item
                {group.capabilities.length !== 1 ? 's' : ''} installed
              </Text>
            </Group>

            {isBrowseCapabilityGroup && (
              <TextInput
                mt='sm'
                mb='xs'
                placeholder='Search capabilities...'
                leftSection={<IHubIconSearch size={16} />}
                value={capabilitySearch}
                onChange={(event) =>
                  setCapabilitySearch(event.currentTarget.value)
                }
                size='sm'
              />
            )}

            {isBrowseCapabilityGroup ? (
              <div className={classes.brokerGroups}>
                {brokerGroups.map((brokerGroup) => (
                  <section
                    className={classes.brokerGroup}
                    data-broker-group={brokerGroup.key}
                    key={brokerGroup.key}
                  >
                    <Text
                      component='h3'
                      className={classes.brokerLabel}
                      size='sm'
                    >
                      {brokerGroup.label}
                    </Text>
                    <Group gap='xs'>
                      {brokerGroup.capabilities.map((capability) =>
                        renderCapability(capability, group.groupName, true),
                      )}
                    </Group>
                  </section>
                ))}
              </div>
            ) : (
              <Group gap='xs'>
                {filteredCapabilities.map((capability) =>
                  renderCapability(capability, group.groupName, false),
                )}
              </Group>
            )}
          </Card>
        )
      })}
    </div>
  )
}
