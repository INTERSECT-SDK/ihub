'use client'

import { ActionIcon, Badge, Group, Stack, Text } from '@mantine/core'
import { IHubIconChevronRight, IHubIconX } from '@ihub/utils/icons'
import type { RefCallback, RefObject } from 'react'

import type {
  CampaignAllNodesEntry,
  CampaignAllNodesGroup,
} from './campaignNodeOverview'
import * as classes from './styles.module.css'

type CampaignAllNodesProps = {
  groups: CampaignAllNodesGroup[]
  headingRef: RefObject<HTMLHeadingElement | null>
  onClose: () => void
  onSelectNode: (entry: CampaignAllNodesEntry) => void
  registerRow: (nodeId: string) => RefCallback<HTMLButtonElement>
}

/** Renders every editable Campaign task in canonical model order. */
export function CampaignAllNodes({
  groups,
  headingRef,
  onClose,
  onSelectNode,
  registerRow,
}: CampaignAllNodesProps) {
  const hasNodes = groups.some(({ entries }) => entries.length > 0)

  return (
    <div className={classes.campaignAllNodes}>
      <Group
        className={classes.campaignAllNodesHeader}
        justify='space-between'
        wrap='nowrap'
      >
        <Text ref={headingRef} component='h2' tabIndex={-1} size='md' fw={600}>
          Nodes List
        </Text>
        <ActionIcon
          variant='subtle'
          color='gray'
          aria-label='Close Nodes List'
          onClick={onClose}
        >
          <IHubIconX size={16} />
        </ActionIcon>
      </Group>

      <Stack className={classes.campaignAllNodesContent} gap='lg'>
        {groups.length === 0 ? (
          <Text size='sm' c='dimmed'>
            This campaign has no task groups.
          </Text>
        ) : (
          groups.map((group) => (
            <section key={group.taskGroupId}>
              <Text component='h3' size='sm' fw={600} mb='xs'>
                {group.label}
              </Text>
              {group.entries.length === 0 ? (
                <Text size='sm' c='dimmed'>
                  No nodes in this task group.
                </Text>
              ) : (
                <Stack gap='xs'>
                  {group.entries.map((entry) => (
                    <button
                      key={entry.nodeId}
                      ref={registerRow(entry.nodeId)}
                      type='button'
                      className={classes.campaignAllNodesRow}
                      onClick={() => onSelectNode(entry)}
                    >
                      <span className={classes.campaignAllNodesRowText}>
                        <Text size='sm' fw={600} truncate>
                          {entry.title}
                        </Text>
                        {entry.subtitle && (
                          <Text size='xs' c='dimmed' truncate>
                            {entry.subtitle}
                          </Text>
                        )}
                      </span>
                      <Badge size='xs' variant='light'>
                        {entry.typeLabel}
                      </Badge>
                      <IHubIconChevronRight size={16} aria-hidden />
                    </button>
                  ))}
                </Stack>
              )}
            </section>
          ))
        )}
        {!hasNodes && groups.length > 0 && (
          <Text size='sm' c='dimmed'>
            Add a node to a task group to see it here.
          </Text>
        )}
      </Stack>
    </div>
  )
}
