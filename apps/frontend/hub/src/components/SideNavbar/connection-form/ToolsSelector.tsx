import { Badge, Box, Button, Group, Menu, Text } from '@mantine/core'
import { IconCheck, IconChevronDown } from '@tabler/icons-react'
import { useMemo } from 'react'

import { FORM_CONTROL_RADIUS } from './constants'
import type { ToolOption } from './types'

type ToolsSelectorProps = {
  tools: ToolOption[]
  selectedToolIds: string[]
  onChange: (toolIds: string[]) => void
}

/**
 * Grouped selector for MCP tools used by the agent `tool_ids` field.
 *
 * Tools are grouped by MCP server, selections are normalized to string IDs, and
 * each group keeps the existing select-all and clear interactions.
 */
export function ToolsSelector({
  tools,
  selectedToolIds,
  onChange,
}: ToolsSelectorProps) {
  const normalizedSelectedToolIds = Array.isArray(selectedToolIds)
    ? selectedToolIds.map((id) => String(id))
    : []
  const groupedTools = useMemo(() => {
    const toolsByServer = (Array.isArray(tools) ? tools : []).reduce(
      (acc, tool) => {
        if (!tool || tool.mcp_server_id === undefined || !tool.id) {
          return acc
        }

        if (!acc[tool.mcp_server_id]) {
          acc[tool.mcp_server_id] = []
        }
        acc[tool.mcp_server_id].push(tool)
        return acc
      },
      {} as Record<number, ToolOption[]>,
    )

    return Object.keys(toolsByServer)
      .map(Number)
      .sort((a, b) => a - b)
      .map((serverId) => {
        const serverTools = toolsByServer[serverId] || []
        const serverLabel =
          serverTools[0]?.mcp_server_label || `MCP Server #${serverId}`

        return {
          serverId,
          group: serverLabel,
          toolIds: serverTools.map((tool) => String(tool.id)),
          items: serverTools.map((tool) => ({
            value: String(tool.id),
            label: tool.tool_name,
          })),
        }
      })
  }, [tools])

  const selectedToolIdSet = new Set(normalizedSelectedToolIds)
  const selectedTools = (Array.isArray(tools) ? tools : []).filter((tool) =>
    selectedToolIdSet.has(String(tool.id)),
  )

  const selectedSummary =
    selectedTools.length === 0
      ? 'No tools selected'
      : selectedTools.length === 1
        ? selectedTools[0].tool_name
        : `${selectedTools.length} tools selected`

  const handleToggleTool = (toolId: string) => {
    const id = String(toolId)
    const nextSelection = selectedToolIdSet.has(id)
      ? normalizedSelectedToolIds.filter((selectedId) => selectedId !== id)
      : [...normalizedSelectedToolIds, id]
    onChange(nextSelection)
  }

  const handleSelectAllServer = (toolIds: string[]) => {
    const nextSelection = Array.from(
      new Set([...normalizedSelectedToolIds, ...toolIds]),
    )
    onChange(nextSelection)
  }

  const handleClearServer = (toolIds: string[]) => {
    const toolIdSet = new Set(toolIds)
    const nextSelection = normalizedSelectedToolIds.filter(
      (id) => !toolIdSet.has(id),
    )
    onChange(nextSelection)
  }

  return (
    <Box mt={2}>
      <Menu
        shadow='md'
        width={360}
        position='bottom-start'
        closeOnItemClick={false}
        withinPortal
        styles={{
          dropdown: {
            borderRadius: '12px',
            borderColor: 'var(--mantine-color-gray-3)',
            padding: '6px',
            maxHeight: 'min(420px, calc(100vh - 120px))',
            overflowY: 'auto',
          },
        }}
      >
        <Menu.Target>
          <Button
            type='button'
            variant='outline'
            justify='space-between'
            fullWidth
            radius={FORM_CONTROL_RADIUS}
            color='var(--mantine-color-gray-7)'
            styles={{
              root: {
                borderColor: 'var(--mantine-color-gray-3)',
                background: 'var(--mantine-color-body)',
              },
            }}
            rightSection={<IconChevronDown size={14} />}
          >
            <Text
              size='sm'
              c={
                selectedTools.length === 0
                  ? 'var(--mantine-color-gray-5)'
                  : 'inherit'
              }
              fw={400}
            >
              {selectedSummary}
            </Text>
          </Button>
        </Menu.Target>

        <Menu.Dropdown>
          {groupedTools.length === 0 ? (
            <Menu.Label>No tools available</Menu.Label>
          ) : (
            groupedTools.map(({ serverId, group, toolIds, items }) => {
              const selectedCount = toolIds.filter((id) =>
                selectedToolIdSet.has(id),
              ).length
              const allSelected =
                selectedCount > 0 && selectedCount === toolIds.length

              return (
                <Box key={`tool-group-${serverId}`} mb='xs'>
                  <Group justify='space-between' align='center' px='xs' py={4}>
                    <Text size='xs' fw={600} c='dimmed'>
                      {group} ({selectedCount}/{toolIds.length})
                    </Text>
                    <Group gap={4}>
                      <Button
                        type='button'
                        size='compact-xs'
                        variant='subtle'
                        disabled={allSelected}
                        onClick={() => handleSelectAllServer(toolIds)}
                      >
                        Select all
                      </Button>
                      <Button
                        type='button'
                        size='compact-xs'
                        variant='subtle'
                        color='gray'
                        disabled={selectedCount === 0}
                        onClick={() => handleClearServer(toolIds)}
                      >
                        Clear
                      </Button>
                    </Group>
                  </Group>
                  {items.map((tool) => {
                    const isSelected = selectedToolIdSet.has(tool.value)

                    return (
                      <Menu.Item
                        key={tool.value}
                        leftSection={
                          isSelected ? <IconCheck size={14} /> : null
                        }
                        onClick={() => handleToggleTool(tool.value)}
                      >
                        {tool.label}
                      </Menu.Item>
                    )
                  })}
                  <Menu.Divider />
                </Box>
              )
            })
          )}
        </Menu.Dropdown>
      </Menu>

      {selectedTools.length > 0 && (
        <Group gap={6} mt='xs'>
          {selectedTools.slice(0, 3).map((tool) => (
            <Badge key={tool.id} size='xs' variant='light'>
              {tool.tool_name}
            </Badge>
          ))}
          {selectedTools.length > 3 && (
            <Text size='xs' c='dimmed'>
              +{selectedTools.length - 3} more
            </Text>
          )}
        </Group>
      )}
    </Box>
  )
}
