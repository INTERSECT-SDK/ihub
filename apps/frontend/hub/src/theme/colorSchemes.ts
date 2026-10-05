import { type MantineThemeOverride } from '@mantine/core'

export type ThemeSchemeId =
  | 'current-light'
  | 'soft-light'
  | 'midnight-dark'
  | 'azure-dark'

type ThemeSchemeDefinition = {
  label: string
  colorScheme: 'light' | 'dark'
  theme: MantineThemeOverride
}

const currentLightColors = {
  blue: [
    '#e7f5ff',
    '#d0ebff',
    '#a5d8ff',
    '#74c0fc',
    '#4dabf7',
    '#339af0',
    '#228be6',
    '#1c7ed6',
    '#1971c2',
    '#1864ab',
  ],
  gray: [
    '#f8f9fa',
    '#f1f3f5',
    '#e9ecef',
    '#dee2e6',
    '#ced4da',
    '#adb5bd',
    '#868e96',
    '#495057',
    '#343a40',
    '#212529',
  ],
  dark: [
    '#d9dde5',
    '#bec5d2',
    '#a2acc0',
    '#8792ab',
    '#6c7792',
    '#515c79',
    '#394158',
    '#23293d',
    '#151a2a',
    '#0b1020',
  ],
}

const softLightColors = {
  blue: [
    '#fff4ec',
    '#ffe8d9',
    '#ffd4b8',
    '#ffbd94',
    '#f7a471',
    '#e78d58',
    '#cf7442',
    '#ad5c34',
    '#8a4729',
    '#66331f',
  ],
  gray: [
    '#fffdfb',
    '#faf3ec',
    '#f2e7dd',
    '#e7d6c8',
    '#d9c1af',
    '#c4a894',
    '#a88c78',
    '#866d5a',
    '#665244',
    '#47392f',
  ],
  dark: [
    '#e3d8cd',
    '#c9bbad',
    '#ae9f8e',
    '#938272',
    '#786657',
    '#5f4f42',
    '#493c31',
    '#342a22',
    '#221b16',
    '#14100d',
  ],
}

const midnightDarkColors = {
  blue: [
    '#e3f2fd',
    '#bbdefb',
    '#90caf9',
    '#64b5f6',
    '#42a5f5',
    '#2196f3',
    '#1e88e5',
    '#1976d2',
    '#1565c0',
    '#0d47a1',
  ],
  gray: [
    '#f5f5f5',
    '#eeeeee',
    '#e0e0e0',
    '#bdbdbd',
    '#9e9e9e',
    '#757575',
    '#616161',
    '#424242',
    '#212121',
    '#121212',
  ],
  dark: [
    '#e0e0e0',
    '#bdbdbd',
    '#9e9e9e',
    '#757575',
    '#616161',
    '#424242',
    '#303030',
    '#212121',
    '#121212',
    '#000000',
  ],
}

const azureDarkColors = {
  blue: [
    '#e5f3ff',
    '#c9e5ff',
    '#9fd0ff',
    '#6eb6ff',
    '#4199ff',
    '#2a7ef0',
    '#1f67d0',
    '#184ea8',
    '#12387f',
    '#0c2558',
  ],
  gray: [
    '#dbe5f5',
    '#bccbe2',
    '#9eb1cf',
    '#8195b8',
    '#64789e',
    '#4a5c83',
    '#344266',
    '#212d4a',
    '#141b32',
    '#0b1020',
  ],
  dark: [
    '#d5e1f4',
    '#b7c7e3',
    '#98add0',
    '#7892ba',
    '#5b78a3',
    '#425d85',
    '#2d4566',
    '#1c2f49',
    '#101d2e',
    '#08101d',
  ],
}

export const themeSchemes: Record<ThemeSchemeId, ThemeSchemeDefinition> = {
  'current-light': {
    label: 'Current Light',
    colorScheme: 'light',
    theme: {
      colors: currentLightColors,
      primaryColor: 'blue',
      primaryShade: 6,
      headings: {
        sizes: {
          h1: { fontSize: '36px' },
        },
      },
    },
  },
  'soft-light': {
    label: 'Soft Light',
    colorScheme: 'light',
    theme: {
      colors: softLightColors,
      primaryColor: 'blue',
      primaryShade: 6,
      headings: {
        sizes: {
          h1: { fontSize: '36px' },
        },
      },
    },
  },
  'midnight-dark': {
    label: 'Midnight Dark',
    colorScheme: 'dark',
    theme: {
      colors: midnightDarkColors,
      primaryColor: 'blue',
      primaryShade: 7,
      headings: {
        sizes: {
          h1: { fontSize: '36px' },
        },
      },
    },
  },
  'azure-dark': {
    label: 'Azure Dark',
    colorScheme: 'dark',
    theme: {
      colors: azureDarkColors,
      primaryColor: 'blue',
      primaryShade: 7,
      headings: {
        sizes: {
          h1: { fontSize: '36px' },
        },
      },
    },
  },
}

export const themeSchemeSelectData = [
  {
    group: 'Light',
    items: [
      { value: 'current-light', label: 'Default' },
      { value: 'soft-light', label: 'Light Cream' },
    ],
  },
  {
    group: 'Dark',
    items: [
      { value: 'midnight-dark', label: 'Black' },
      { value: 'azure-dark', label: 'Navy' },
    ],
  },
] satisfies Array<{
  group: string
  items: Array<{ value: ThemeSchemeId; label: string }>
}>

export function getThemeScheme(themeSchemeId: ThemeSchemeId) {
  return themeSchemes[themeSchemeId]
}
