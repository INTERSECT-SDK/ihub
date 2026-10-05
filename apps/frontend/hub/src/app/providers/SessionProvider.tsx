'use client'

import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  createDeduplicatedSessionRefresh,
  requestSession,
  type Session,
  type SessionRefreshResult,
  type SessionStatus,
} from './session.ts'

interface Props {
  children: ReactNode
}

export interface SessionInterface {
  session: Session | undefined
  status: SessionStatus
  error: Error | undefined
  refreshSession: () => Promise<SessionRefreshResult>
  clearSession: () => void
}

const SessionContext = createContext<SessionInterface | undefined>(undefined)

export default function SessionProvider({ children }: Props) {
  if (!SessionContext) {
    throw new Error('React Context is unavailable in Server Components')
  }

  const [session, setSession] = useState<Session>()
  const [status, setStatus] = useState<SessionStatus>('loading')
  const [error, setError] = useState<Error>()
  const refreshGeneration = useRef(0)

  const performRefresh =
    useCallback(async (): Promise<SessionRefreshResult> => {
      const generation = refreshGeneration.current
      setStatus('loading')
      setError(undefined)

      const result = await requestSession()
      if (generation !== refreshGeneration.current) {
        return result
      }

      if (result.status === 'authenticated') {
        setSession(result.session)
        setStatus('authenticated')
      } else if (result.status === 'unauthenticated') {
        setSession(undefined)
        setStatus('unauthenticated')
      } else {
        setStatus('error')
        setError(result.error)
      }

      return result
    }, [])

  const refreshController = useMemo(
    () => createDeduplicatedSessionRefresh(performRefresh),
    [performRefresh],
  )
  const refreshSession = refreshController.refresh

  const clearSession = useCallback(() => {
    refreshGeneration.current += 1
    refreshController.invalidate()
    setSession(undefined)
    setError(undefined)
    setStatus('unauthenticated')
  }, [refreshController])

  useEffect(() => {
    void refreshSession()
  }, [refreshSession])

  const value = useMemo<SessionInterface>(
    () => ({
      session,
      status,
      error,
      refreshSession,
      clearSession,
    }),
    [clearSession, error, refreshSession, session, status],
  )

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  )
}

export function useSession() {
  const context = useContext(SessionContext)
  if (context === undefined) {
    throw new Error('useSession must be used within a SessionProvider')
  }
  return context
}
