import type { Metadata } from 'next'
import './globals.css'

/* import mantine */
import '@mantine/core/styles.css'

/* import react-flow */
import '@xyflow/react/dist/style.css'
import Providers from './providers/Providers.js'

export const metadata: Metadata = {
  title: 'iHub',
  description: 'User interface for the INTERSECT ecosystem.',
  icons: {
    icon: '/intersect_icon_dark.svg',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang='en'>
      <head>
        <meta charSet='UTF-8' />
        <meta name='viewport' content='width=device-width, initial-scale=1.0' />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
