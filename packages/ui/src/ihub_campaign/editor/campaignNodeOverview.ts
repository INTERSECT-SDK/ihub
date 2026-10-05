import type { CampaignModel, CampaignTask } from '@ihub/utils/types/campaign'

import type { CampaignInspectorNodeType } from './campaignInspectorState'

export type CampaignAllNodesEntry = {
  taskGroupId: string
  taskGroupLabel: string
  nodeId: string
  nodeType: CampaignInspectorNodeType
  title: string
  typeLabel: string
  subtitle?: string
}

export type CampaignAllNodesGroup = {
  taskGroupId: string
  label: string
  entries: CampaignAllNodesEntry[]
}

function getCapabilityTitle(task: CampaignTask, taskIndex: number) {
  return (
    task.capability_metadata?.name || task.capability || `Task ${taskIndex + 1}`
  )
}

function deriveTaskEntry(
  task: CampaignTask,
  taskIndex: number,
): Omit<CampaignAllNodesEntry, 'taskGroupId' | 'taskGroupLabel'> | null {
  if (task.code_data) {
    return {
      nodeId: task.id,
      nodeType: 'code',
      title: task.code_data.name || `Code ${taskIndex + 1}`,
      typeLabel: 'Code',
    }
  }

  if (task.hierarchy === 'visualization' || task.visualization_data) {
    return {
      nodeId: task.id,
      nodeType: 'visualization',
      title: task.visualization_data?.name || `Visualization ${taskIndex + 1}`,
      typeLabel: 'Visualization',
    }
  }

  if (task.hierarchy === 'renderer' || task.renderer_data) {
    const nodeType =
      task.renderer_data?.type === 'image-renderer' ||
      task.operation_id === 'image-renderer'
        ? 'image-renderer'
        : 'text-renderer'
    return {
      nodeId: task.id,
      nodeType,
      title: task.renderer_data?.name || `Renderer ${taskIndex + 1}`,
      typeLabel:
        nodeType === 'image-renderer' ? 'Image Renderer' : 'Text Renderer',
    }
  }

  if (task.hierarchy === 'json-file' && task.json_file_data) {
    return {
      nodeId: task.id,
      nodeType: 'json-file',
      title: task.json_file_data.name || `JSON File ${taskIndex + 1}`,
      typeLabel: 'JSON File',
    }
  }

  if (task.hierarchy === 'json-text' && task.json_text_data) {
    return {
      nodeId: task.id,
      nodeType: 'json-text',
      title: task.json_text_data.name || `JSON Text ${taskIndex + 1}`,
      typeLabel: 'JSON Text',
    }
  }

  if (task.event_name && !task.operation_id) {
    return {
      nodeId: task.id,
      nodeType: 'event',
      title: getCapabilityTitle(task, taskIndex),
      typeLabel: 'Event',
      subtitle: task.event_name,
    }
  }

  return {
    nodeId: task.id,
    nodeType: 'capability',
    title: getCapabilityTitle(task, taskIndex),
    typeLabel: 'Capability',
    subtitle: task.operation_id || 'endpoint',
  }
}

/** Derives overview rows in canonical task-group and task order. */
export function deriveCampaignAllNodesGroups(
  campaignModel: CampaignModel,
): CampaignAllNodesGroup[] {
  return campaignModel.task_groups.map((taskGroup, taskGroupIndex) => {
    const label = `Task Group ${taskGroupIndex + 1}`
    return {
      taskGroupId: taskGroup.id,
      label,
      entries: taskGroup.tasks.flatMap((task, taskIndex) => {
        const entry = deriveTaskEntry(task, taskIndex)
        return entry
          ? [
              {
                ...entry,
                taskGroupId: taskGroup.id,
                taskGroupLabel: label,
              },
            ]
          : []
      }),
    }
  })
}
