'use client'

import { MantineProvider, type MantineThemeOverride } from '@mantine/core'
import { useAtomValue } from 'jotai'
import { themeSchemeAtom } from '@/atoms/global'
import SessionProvider from './SessionProvider.js'
import { getThemeScheme } from '@/theme/colorSchemes'

export default function Providers({ children }: { children: React.ReactNode }) {
  const themeScheme = useAtomValue(themeSchemeAtom)
  const selectedTheme: MantineThemeOverride = getThemeScheme(themeScheme).theme

  return (
    <SessionProvider>
      <MantineProvider
        theme={selectedTheme}
        forceColorScheme={getThemeScheme(themeScheme).colorScheme}
      >
        {children}
      </MantineProvider>
    </SessionProvider>
  )
}
