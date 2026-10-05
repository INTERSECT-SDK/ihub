import {
  Accordion,
  AccordionControl,
  AccordionItem,
  AccordionPanel,
  Anchor,
  Breadcrumbs,
  Divider,
  Text,
  UnstyledButton,
} from '@mantine/core'
import {
  IconBraces,
  IconFileText,
  IconFileUnknown,
  IconNotebook,
  IconTransform,
} from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import useSWR from 'swr'
import { IconFolder, IconFolderOpen } from '@tabler/icons-react'
import { Group } from '@mantine/core'
import { CssIcon, NpmIcon, TypeScriptCircleIcon } from '@mantinex/dev-icons'
import classes from './style.module.css'
import { ServerHeader, SortDropdown } from './ViewCommonComponents'
import useTabs from '@/hooks/useTabs'
import {
  buildJupyterContentsUrl,
  buildProjectEditorRoute,
} from '@/app/project/project-file-path.ts'
import { Campaign, Notebook, VisualizationDashboard, Chat } from '@ihub/ui'

import { NewTab } from '@/types'
import { JupyterServerConfig } from '@ihub/utils/types/notebook'
import { ContentFile } from '@ihub/utils/types/types'
import { IHubIconChat, IHubIconGraph } from '@ihub/utils/icons'
import { getFileTabTitle } from '@/hooks/tab-state'

const FILE_NAME_DISPLAY_LENGTH = 15

const fetcher = async ({ url, token }: { url: string; token: string }) => {
  console.log('fetching', url)
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
    },
  })

  if (!response.ok) {
    throw new Error('Network error getting list of files')
  }

  return response.json()
}

export function getFileIconClass(name: string) {
  if (name.endsWith('package.json')) {
    return NpmIcon
  }

  if (
    name.endsWith('.ts') ||
    name.endsWith('.tsx') ||
    name.endsWith('tsconfig.json')
  ) {
    return TypeScriptCircleIcon
  }

  if (name.endsWith('.css')) {
    return CssIcon
  }

  if (name.endsWith('.ipynb')) {
    return IconNotebook
  }

  if (name.endsWith('.ichat')) {
    return IHubIconChat
  }

  if (name.endsWith('.ivis')) {
    return IHubIconGraph
  }

  if (name.endsWith('.json')) {
    return IconBraces
  }

  if (name.endsWith('.icmp')) {
    return IconTransform
  }

  if (name.endsWith('.txt')) {
    return IconFileText
  }

  return IconFileUnknown
}

export function getFileViewerClass(name) {
  if (name.endsWith('package.json')) {
    return null
  }

  if (
    name.endsWith('.ts') ||
    name.endsWith('.tsx') ||
    name.endsWith('tsconfig.json')
  ) {
    return null
  }

  if (name.endsWith('.css')) {
    return null
  }

  if (name.endsWith('.ipynb')) {
    return Notebook
  }

  if (name.endsWith('.ichat')) {
    return Chat
  }

  if (name.endsWith('.ivis')) {
    return VisualizationDashboard
  }

  if (name.endsWith('.json')) {
    return null
  }

  if (name.endsWith('.icmp')) {
    return Campaign
  }

  if (name.endsWith('.txt')) {
    return null
  }

  return null
}

export default function DisplayFileServerNavigator({ servers, icon }) {
  const [sortBy, setSortBy] = useState<string | null>(null)

  let sorted_servers = servers

  if (sortBy !== null) {
    sorted_servers = servers.sort((a: string, b: string) =>
      a[sortBy] > b[sortBy] ? 1 : -1,
    )
  }

  return (
    <>
      <SortDropdown options={['status', 'name']} setSortBy={setSortBy} />

      <Accordion mx={'sm'} variant='separated' radius={'md'} multiple>
        {sorted_servers.map((server: JupyterServerConfig) => (
          <AccordionItem
            mt={0}
            key={`server_type_${server.label}`}
            value={server.label}
          >
            <AccordionControl icon={icon}>
              <FileServerItem server={server} />
            </AccordionControl>
            <AccordionPanel>
              <FileNavigator server={server} />
            </AccordionPanel>
          </AccordionItem>
        ))}
      </Accordion>
    </>
  )
}

/**
 * helper component for each server
 */

function FileServerItem({ server }) {
  const { data, error, isLoading } = useSWR(
    { url: `${server.url}/api/status`, token: server.token },
    fetcher,
  )
  let status = 'disconnected'
  if (isLoading) {
    status = 'connecting'
  } else if (error) {
    status = 'failed'
  } else if (data) {
    status = 'connected'
  }
  return <ServerHeader url={server.url} label={server.label} status={status} />
}

interface FileIconProps {
  name: string
  isFolder: boolean
}

export function FileIcon({ name, isFolder }: FileIconProps) {
  if (name.endsWith('package.json')) {
    return <NpmIcon size={14} />
  }

  if (
    name.endsWith('.ts') ||
    name.endsWith('.tsx') ||
    name.endsWith('tsconfig.json')
  ) {
    return <TypeScriptCircleIcon size={14} />
  }

  if (name.endsWith('.css')) {
    return <CssIcon size={14} />
  }

  if (name.endsWith('.ipynb')) {
    return (
      <IconNotebook stroke={2} size={14} color='var(--mantine-color-blue-9)' />
    )
  }

  if (name.endsWith('.json')) {
    return (
      <IconBraces stroke={2} size={14} color='var(--mantine-color-blue-9)' />
    )
  }

  if (name.endsWith('.icmp')) {
    return (
      <IconTransform stroke={2} size={14} color='var(--mantine-color-blue-9)' />
    )
  }

  if (name.endsWith('.ichat')) {
    return (
      <IHubIconChat stroke={2} size={14} color='var(--mantine-color-blue-9)' />
    )
  }

  if (name.endsWith('.ivis')) {
    return (
      <IHubIconGraph stroke={2} size={14} color='var(--mantine-color-blue-9)' />
    )
  }

  if (name.endsWith('.txt')) {
    return (
      <IconFileText stroke={2} size={14} color='var(--mantine-color-gray-9)' />
    )
  }

  if (isFolder) {
    return (
      <IconFolder
        color='var(--mantine-color-yellow-9)'
        size={14}
        stroke={1.5}
      />
    )
  }

  return <IconFileUnknown size={14} stroke={2.5} />
}

function FileNavigator({ server }) {
  const [currentPath, setCurrentPath] = useState('')
  const [contentList, setContentList] = useState<ContentFile[]>([])
  const [selectedItem, setSelectedItem] = useState(null)
  const { addAndActivateTab } = useTabs()

  console.log(server)
  const fileListKey = currentPath
    ? buildJupyterContentsUrl(server.url, currentPath)
    : `${server.url}/api/contents`
  const { data } = useSWR({ url: fileListKey, token: server.token }, fetcher)

  useEffect(() => {
    if (data !== undefined) {
      setContentList(data.content)
    }
  }, [currentPath, data])

  const handleDoubleClick = (clickedNode) => {
    // console.log(clickedNode)
    if (clickedNode.type === 'directory') {
      setCurrentPath(clickedNode.path)
    } else {
      const newTabId = Date.now()

      // const newTab = {
      //   id: uuidShort,
      //   title: name,
      //   path: path,
      //   type: selectedApp.name,
      //   icon: selectedApp.icon,
      // }
      const fileRoute = buildProjectEditorRoute(clickedNode.path)
      const newTab: NewTab = {
        id: newTabId,
        title: getFileTabTitle(clickedNode.name),
        name: clickedNode.path,
        icon: getFileIconClass(clickedNode.name),
        path: fileRoute,
      }

      void addAndActivateTab(newTab)
    }
  }

  const currentPathSplit = currentPath.split('/')
  let bcItems = currentPathSplit.map((item, index) => (
    <Anchor
      size='xs'
      key={index}
      onClick={() =>
        setCurrentPath(currentPathSplit.slice(0, index + 1).join('/'))
      }
    >
      {item}
    </Anchor>
  ))

  const rootAnchor = (
    <Anchor key={'root-bc'} onClick={() => setCurrentPath('')}>
      <IconFolder size={'12'} />
    </Anchor>
  )

  bcItems = [rootAnchor, ...bcItems]
  const visibleContentList = contentList.sort(
    (a: ContentFile, b: ContentFile) => a.path.localeCompare(b.path),
  )

  return (
    <>
      <>
        <Breadcrumbs m={'xs'}>{bcItems}</Breadcrumbs>
        <Divider my='sm' />
      </>
      {visibleContentList.length === 0 ? (
        <Text size='xs'>No files or folders to show.</Text>
      ) : (
        visibleContentList.map((item: ContentFile) => (
          <FileNavItem
            key={`nav_file_${item.path}`}
            node={item}
            isFolder={item.type === 'directory'}
            selectedItem={selectedItem}
            setSelectedItem={setSelectedItem}
            handleDoubleClick={handleDoubleClick}
          />
        ))
      )}
    </>
  )
}

/**
 * Returns a display-friendly file or folder name, truncating long file base names
 * to `FILE_NAME_DISPLAY_LENGTH` characters and preserving the file extension.
 */
function getDisplayName(name: string, isFolder: boolean) {
  const extensionIndex = name.lastIndexOf('.')
  const hasExtension = extensionIndex > 0 && !isFolder
  const baseName = hasExtension ? name.slice(0, extensionIndex) : name
  const extension = hasExtension ? name.slice(extensionIndex) : ''

  return baseName.length > FILE_NAME_DISPLAY_LENGTH
    ? `${baseName.slice(0, FILE_NAME_DISPLAY_LENGTH)}...${extension}`
    : name
}

function FileNavItem({
  node,
  isFolder,
  selectedItem,
  setSelectedItem,
  handleDoubleClick,
}) {
  return (
    <UnstyledButton
      className={classes.fileNavItem}
      data-active={selectedItem == node.path}
      onClick={() => setSelectedItem(node.path)}
      onDoubleClick={() => handleDoubleClick(node)}
      size={'sm'}
    >
      <Group gap={5}>
        <FileIcon name={node.name} isFolder={isFolder} />
        <Text size='sm'>{getDisplayName(node.name, isFolder)}</Text>
      </Group>
    </UnstyledButton>
  )
}
