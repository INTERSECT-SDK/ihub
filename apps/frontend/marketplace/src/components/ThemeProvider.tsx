'use client'

import { MantineProvider, createTheme } from '@mantine/core'

const theme = createTheme({
  colors: {},
  headings: {
    sizes: {
      h1: { fontSize: '36px' },
    },
  },
})

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return <MantineProvider theme={theme}>{children}</MantineProvider>
}
