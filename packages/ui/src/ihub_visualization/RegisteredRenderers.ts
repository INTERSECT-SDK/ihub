import type {
  ImageRendererNode,
  TextRendererNode,
} from '@ihub/utils/types/campaign'

export type RendererRegistryEntry = {
  name: string
  type: ImageRendererNode['type'] | TextRendererNode['type']
  inputs: { key: string; label: string; description: string }[]
}

export const RendererRegistry: RendererRegistryEntry[] = [
  {
    name: 'Image',
    type: 'image-renderer',
    inputs: [
      {
        key: 'image',
        label: 'Image data',
        description: 'Byte string, byte array, base64 value, or data URL',
      },
    ],
  },
  {
    name: 'Text',
    type: 'text-renderer',
    inputs: [
      {
        key: 'text',
        label: 'Text value',
        description: 'Value to display as text',
      },
    ],
  },
]

export const RendererRegistryByType = RendererRegistry.reduce(
  (entries, entry) => {
    entries[entry.type] = entry
    return entries
  },
  {} as Record<string, RendererRegistryEntry>,
)
