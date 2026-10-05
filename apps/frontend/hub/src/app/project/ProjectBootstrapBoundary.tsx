'use client'

import { jupyterServersAtom } from '@/atoms/global.ts'
import {
  Button,
  Card,
  Center,
  Container,
  Loader,
  Stack,
  Text,
} from '@mantine/core'
import { useSetAtom } from 'jotai'
import { useRouter } from 'next/navigation.js'
import { useEffect, useMemo, useState } from 'react'

import { useSession } from '../providers/SessionProvider.tsx'
import {
  bootstrapJupyterServer,
  getJupyterIdentity,
} from './jupyter-bootstrap.ts'

type JupyterBootstrapStatus = 'loading' | 'ready' | 'error'

function LoadingState() {
  return (
    <Center mih='40vh'>
      <Stack align='center'>
        <Loader />
        <Text>Restoring your project session...</Text>
      </Stack>
    </Center>
  )
}

function RetryState({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  return (
    <Container py='xl'>
      <Card withBorder>
        <Stack>
          <Text>{message}</Text>
          <Button onClick={onRetry}>Retry</Button>
        </Stack>
      </Card>
    </Container>
  )
}

/**
 * Ensures a project route renders only after the authenticated user's Jupyter
 * server context has been restored.
 *
 * While bootstrapping, it shows a loading state; when bootstrap fails, it
 * renders a retry state; when unauthenticated, it redirects to `/login`.
 *
 * @param props - Boundary props.
 * @param props.children - Content to render after session and Jupyter
 * initialization are ready.
 */
export default function ProjectBootstrapBoundary({
  children,
}: {
  children: React.ReactNode
}) {
  const { session, status: sessionStatus, refreshSession } = useSession()
  const setJupyterServers = useSetAtom(jupyterServersAtom)
  const router = useRouter()
  const [bootstrapStatus, setBootstrapStatus] =
    useState<JupyterBootstrapStatus>('loading')
  const [bootstrapError, setBootstrapError] = useState<Error>()
  const [attempt, setAttempt] = useState(0)
  const identity = useMemo(
    () => (session ? getJupyterIdentity(session) : undefined),
    [session],
  )

  useEffect(() => {
    if (sessionStatus === 'unauthenticated') {
      setJupyterServers([])
      router.replace('/login')
    }
  }, [router, sessionStatus, setJupyterServers])

  useEffect(() => {
    if (sessionStatus !== 'authenticated' || !session || !identity) {
      return
    }

    const abortController = new AbortController()
    setJupyterServers([])
    setBootstrapStatus('loading')
    setBootstrapError(undefined)

    const initialize = async () => {
      try {
        const server = await bootstrapJupyterServer({
          session,
          signal: abortController.signal,
        })
        if (abortController.signal.aborted) {
          return
        }
        setJupyterServers([server])
        setBootstrapStatus('ready')
      } catch (error) {
        if (abortController.signal.aborted) {
          return
        }
        setJupyterServers([])
        setBootstrapError(
          error instanceof Error
            ? error
            : new Error('Failed to initialize Jupyter'),
        )
        setBootstrapStatus('error')
      }
    }

    void initialize()
    return () => {
      abortController.abort()
      setJupyterServers([])
    }
  }, [attempt, identity, session, sessionStatus, setJupyterServers])

  if (sessionStatus === 'error') {
    return (
      <RetryState
        message='Unable to restore your session. Please try again.'
        onRetry={() => void refreshSession()}
      />
    )
  }

  if (
    sessionStatus !== 'authenticated' ||
    bootstrapStatus === 'loading' ||
    !identity
  ) {
    return <LoadingState />
  }

  if (bootstrapStatus === 'error') {
    return (
      <RetryState
        message={
          bootstrapError?.message ||
          'Unable to initialize your Jupyter server. Please try again.'
        }
        onRetry={() => setAttempt((current) => current + 1)}
      />
    )
  }

  return children
}
