import { Group, Select, Stack, Text, type ComboboxData } from '@mantine/core'

import type { VisualizationMappingState } from './VisualizationMapping'
import { parseVisualizationMappingValue } from './VisualizationMapping'

type VisualizationInput = {
  key: string
  label: string
  description?: string
}

/** Renders visualization input mapping controls. */
export function VisualizationConfiguration({
  inputs,
  options,
  mappings,
  setMappings,
  readOnly = false,
}: {
  inputs: VisualizationInput[]
  options: ComboboxData
  mappings: VisualizationMappingState
  setMappings: React.Dispatch<React.SetStateAction<VisualizationMappingState>>
  readOnly?: boolean
}) {
  if (inputs.length === 0) {
    return (
      <Text size='sm' c='dimmed'>
        No configurable inputs for this visualization type
      </Text>
    )
  }

  const hasOptions = Array.isArray(options) && options.length > 0
  return (
    <Stack gap='sm' style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
      {inputs.map((input) => {
        const selectedMapping = mappings[input.key]
        const selectedValue =
          typeof selectedMapping === 'string'
            ? selectedMapping
            : selectedMapping?.sourceNodeId && selectedMapping.sourcePath
              ? `${selectedMapping.sourceNodeId}:::${selectedMapping.sourcePath}`
              : null

        return (
          <div key={input.key}>
            <Group gap={6} justify='space-between'>
              <Text size='sm' fw={500}>
                {input.label}
              </Text>
              {input.description && (
                <Text size='xs' c='dimmed'>
                  {input.description}
                </Text>
              )}
            </Group>
            <Select
              size='xs'
              radius='xl'
              placeholder={
                hasOptions ? 'Select source data' : 'No available inputs'
              }
              data={options}
              value={selectedValue}
              clearable
              disabled={readOnly || !hasOptions}
              onChange={(value) => {
                if (readOnly) return
                setMappings((previousMappings) => ({
                  ...previousMappings,
                  [input.key]: parseVisualizationMappingValue(value),
                }))
              }}
            />
          </div>
        )
      })}
    </Stack>
  )
}
