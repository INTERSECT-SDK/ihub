import { LauncherCapabilities } from '@/types.ts'

import { Campaign, Chat, Notebook, VisualizationDashboard } from '@ihub/ui'
import { IHubIconChat } from '@ihub/utils/icons'

import { IconNotebook, IconTransform } from '@tabler/icons-react'

export const fileFormatToViewerMapping = {
  icmp: Campaign,
  ipynb: Notebook,
  ivis: VisualizationDashboard,
  ichat: Chat,
}

export const lauchnerCapabilitiesList: LauncherCapabilities[] = [
  // group 1: document types
  {
    groupName: 'Create a document',
    capabilities: [
      {
        label: 'Campaign',
        name: 'campaign-builder',
        tooltip: 'Build and run workflows with INTERSECT capabilities.',
        icon: IconTransform,
        file_extension: 'icmp',
        view: Campaign,
      },
      {
        label: 'Notebook',
        name: 'notebook',
        tooltip: 'Create and run Jupyter notebooks.',
        icon: IconNotebook,
        color: '',
        file_extension: 'ipynb',
        view: Notebook,
      },
      // {
      //   label: 'Visualization',
      //   name: 'visualization',
      //   icon: IHubIconGraph,
      //   file_extension: 'ivis',
      //   view: VisualizationDashboard,
      // },
      {
        label: 'LLM Chat',
        name: 'llmchat',
        tooltip: 'Chat with iHub agents and assistants.',
        icon: IHubIconChat,
        file_extension: 'ichat',
        view: Chat,
      },
    ],
  },

  // Adding for Agentic AI demo
  // {
  //   groupName: 'Experimental capabilities',
  //   capabilities: [
  //     {
  //       label: 'AM Assistant',
  //       name: 'additive-manufacturing-assistant',
  //       icon: IconRobot,
  //       file_extension: 'ichat',
  //       view: Chat,
  //     },
  //   ],
  // },
]
