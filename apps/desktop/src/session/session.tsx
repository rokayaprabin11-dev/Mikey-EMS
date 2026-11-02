import type { Session } from '@mikey/shared'
import { useQueryClient } from '@tanstack/react-query'
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react'

import { api } from '../api/client.ts'
import { usePaymentUnfinished } from '../collect/payment.tsx'
import { IdleWarning } from './IdleWarning.tsx'
import { isSessionGone } from './keep-alive.ts'

interface SessionValue {
  session: Session | null
  // Why the last session ended, for the sign-in screen.
  notice: string | null
  signIn: (username: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

const SessionContext = createContext<SessionValue | null>(null)

export function useSession(): SessionValue {
  const value = useContext(SessionContext)
  if (value === null) {
    throw new Error('useSession is used outside SessionProvider.')
  }
  return value
}

// The signed-in person, kept in memory only (ARCHITECTURE.md, Sessions and auth).
export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const paymentUnfinished = usePaymentUnfinished()
  const [session, setSession] = useState<Session | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // Nothing of the last person's stays behind: no token, and no data in the cache.
  const end = useCallback(
    (why: string | null) => {
      api.setToken(null)
      queryClient.clear()
      setSession(null)
      setNotice(why)
    },
    [queryClient],
  )

  useEffect(() => {
    api.onSessionEnded((error) => end(error.message))
    return () => api.onSessionEnded(null)
  }, [end])

  const value = useMemo<SessionValue>(
    () => ({
      session,
      notice,
      async signIn(username, password) {
        const { token, ...signedIn } = await api.call('login', { body: { username, password } })
        api.setToken(token)
        setSession(signedIn)
        setNotice(null)
      },
      async signOut() {
        try {
          await api.call('logout')
        } catch (error) {
          if (!isSessionGone(error)) {
            throw error
          }
        }
        end(null)
      },
    }),
    [session, notice, end],
  )

  return (
    <SessionContext value={value}>
      {children}
      {session !== null && (
        <IdleWarning
          idleMinutes={session.idleTimeoutMinutes}
          paused={paymentUnfinished}
          onSignOut={() => void value.signOut()}
          onEnd={end}
        />
      )}
    </SessionContext>
  )
}
