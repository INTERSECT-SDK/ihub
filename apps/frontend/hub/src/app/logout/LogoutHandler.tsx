'use client'

import { useRouter } from 'next/navigation.js'
import { Container } from '@mantine/core'
import { useEffect } from 'react'
import { useSession } from '../providers/SessionProvider.tsx'
import { useSetAtom } from 'jotai'
import { jupyterServersAtom } from '@/atoms/global.ts'

export default function LogoutHandler() {
  const { clearSession } = useSession()
  const clearJupyterServers = useSetAtom(jupyterServersAtom)
  const router = useRouter()

  /**
   * Performs a best-effort server logout on mount, then always clears local
   * auth/session state and redirects to the login page.
   */
  useEffect(() => {
    const performLogout = async () => {
      try {
        await fetch('/api/v1/auth/logout', {
          method: 'POST',
          credentials: 'include',
        })
      } catch (error) {
        console.error('Logout request failed:', error)
      } finally {
        clearSession()
        clearJupyterServers([])
        router.replace('/login')
      }
    }

    performLogout()
  }, [clearJupyterServers, clearSession, router])

  return <Container>Logging out...</Container>
}
