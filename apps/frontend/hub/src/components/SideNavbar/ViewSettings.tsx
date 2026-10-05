'use client'

import { Paper, Select, Stack, Text } from '@mantine/core'
import { useAtom } from 'jotai'
import { themeSchemeAtom } from '@/atoms/global'
import { themeSchemeSelectData } from '@/theme/colorSchemes'

export default function DisplaySettings() {
  const [themeScheme, setThemeScheme] = useAtom(themeSchemeAtom)

  return (
    <Paper withBorder radius='md' p='md' m='md'>
      <Stack gap='xs'>
        <Text fw={600}>Appearance</Text>
        <Text size='xs' c='dimmed'>
          Choose one of the light or dark color schemes for the interface.
        </Text>
        <Select
          label='Color scheme'
          placeholder='Select a color scheme'
          data={themeSchemeSelectData}
          value={themeScheme}
          onChange={(value) => {
            if (value) {
              setThemeScheme(value)
            }
          }}
        />
      </Stack>
    </Paper>
  )
}
