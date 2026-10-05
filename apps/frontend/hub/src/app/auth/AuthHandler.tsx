'use client'

import { useRouter } from 'next/navigation.js'
import { Button, Container, Stack, Text } from '@mantine/core'
import { useEffect, useState } from 'react'
import { useSession } from '../providers/SessionProvider.tsx'

export default function AuthHandler() {
  const { refreshSession } = useSession()
  const router = useRouter()
  const [attempt, setAttempt] = useState(0)
  const [error, setError] = useState<Error>()

  /**
   * Restores the user session on mount and when a retry is requested.
   *
   * Redirects authenticated users to `/project`, unauthenticated users to
   * `/login`, and surfaces unexpected refresh errors for the retry UI. The
   * cleanup guard prevents state updates after unmount.
   */
  useEffect(() => {
    let active = true

    const loadUser = async () => {
      const result = await refreshSession()
      if (!active) {
        return
      }

      if (result.status === 'authenticated') {
        router.replace('/project')
      } else if (result.status === 'unauthenticated') {
        router.replace('/login')
      } else {
        setError(result.error)
      }
    }

    void loadUser()
    return () => {
      active = false
    }
  }, [attempt, refreshSession, router])

  if (error) {
    return (
      <Container>
        <Stack>
          <Text>Unable to restore your session. Please try again.</Text>
          <Button
            onClick={() => {
              setError(undefined)
              setAttempt((current) => current + 1)
            }}
          >
            Retry
          </Button>
        </Stack>
      </Container>
    )
  }

  return <Container>Please wait...</Container>
}
