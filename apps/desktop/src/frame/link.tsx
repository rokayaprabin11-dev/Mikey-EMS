import { useQuery } from '@tanstack/react-query'
import { createContext, type ReactNode, useContext, useEffect, useMemo, useRef, useState } from 'react'

import { addressOf } from '../../electron/server-address.ts'
import { bridge } from '../bridge.ts'
import { databaseDownProblem, type Problem, problemOf } from '../connection.ts'
import { type HealthCheck, useHealth } from '../health.ts'

// ARCHITECTURE.md, Health and connection status: "Reconnecting" after 2 checks in a row that
// failed, and the blocking screen once Computer 1 has not answered for 15 seconds. A reply that
// says the database has stopped counts as no reply: nothing can be done without it.
const RECONNECTING_AFTER = 2
const UNAVAILABLE_AFTER_MS = 15_000

export interface Link {
  address: string
  state: 'checking' | 'connected' | 'reconnecting' | 'unavailable'
  // The last good answer, and when it came on this computer's clock.
  last: { check: HealthCheck; at: number } | null
  // While the checks fail: since when, until when, how many in a row, and what is wrong.
  failing: { since: number; latest: number; attempts: number; problem: Problem } | null
  retry: () => void
}

const LinkContext = createContext<Link | null>(null)

export function useLink(): Link {
  const link = useContext(LinkContext)
  if (link === null) {
    throw new Error('useLink is used outside LinkProvider.')
  }
  return link
}

type Watch = Pick<Link, 'last' | 'failing'>

export function LinkProvider({ children }: { children: ReactNode }) {
  const saved = useQuery({ queryKey: ['server-url'], queryFn: () => bridge().getServerUrl() })
  const health = useHealth()
  const address = saved.data ? addressOf(saved.data) : ''
  const [watch, setWatch] = useState<Watch>({ last: null, failing: null })

  // Each check that finishes, good or bad, moves the watch on once.
  const { data, error, dataUpdatedAt, errorUpdatedAt } = health
  const counted = useRef(0)
  useEffect(() => {
    const failedAt = errorUpdatedAt > dataUpdatedAt ? errorUpdatedAt : null
    const at = failedAt ?? dataUpdatedAt
    if ((failedAt === null && data === undefined) || at === counted.current) {
      return
    }
    counted.current = at
    let problem: Problem | null = null
    if (failedAt !== null) {
      problem = problemOf(error, address)
    } else if (data?.health.db === 'down') {
      problem = databaseDownProblem(data.health)
    }
    setWatch((previous) => {
      if (problem === null) {
        return data === undefined ? previous : { last: { check: data, at }, failing: null }
      }
      const failing = previous.failing ?? { since: at, latest: at, attempts: 0, problem }
      return { last: previous.last, failing: { ...failing, latest: at, attempts: failing.attempts + 1, problem } }
    })
  }, [data, error, dataUpdatedAt, errorUpdatedAt, address])

  const { refetch } = health
  const link = useMemo<Link>(() => {
    let state: Link['state'] = watch.last === null ? 'checking' : 'connected'
    const { failing } = watch
    if (failing !== null && failing.attempts >= RECONNECTING_AFTER) {
      state = failing.latest - failing.since >= UNAVAILABLE_AFTER_MS ? 'unavailable' : 'reconnecting'
    }
    return { address, state, last: watch.last, failing: watch.failing, retry: () => void refetch() }
  }, [address, watch, refetch])

  return <LinkContext value={link}>{children}</LinkContext>
}
