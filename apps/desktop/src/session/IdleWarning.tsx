import { errorMessage } from '@mikey/shared'
import { useEffect, useRef, useState } from 'react'

import { api, UnreachableError } from '../api/client.ts'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '../components/ui/alert-dialog.tsx'
import { en } from '../i18n/en.ts'
import { isSessionGone, keepAlive } from './keep-alive.ts'

const words = en.idle
const MINUTE_MS = 60_000
// The warning shows for the last minute (ARCHITECTURE.md, Sessions and auth).
const WARNING_MS = MINUTE_MS
// Activity tells Computer 1 at most once a minute.
const KEEP_ALIVE_MS = MINUTE_MS
const TICK_MS = 1_000
const ACTIVITY = ['keydown', 'pointerdown', 'wheel'] as const

function countdown(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1_000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

// Signs out after `idleMinutes` without activity, warning in the last minute. Keys, clicks and
// scrolling are activity, so a long form being typed never runs out; the server's idle time
// starts again with every signed-in request. While a confirmed payment is not finished (`paused`),
// this computer does not sign out by itself: its "Not confirmed yet" box stays until Computer 1
// answers, and Computer 1 then decides whether the session has ended.
export function IdleWarning({
  idleMinutes,
  paused,
  onSignOut,
  onEnd,
}: {
  idleMinutes: number
  paused: boolean
  onSignOut: () => void
  onEnd: (why: string) => void
}) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(timer)
  }, [])

  const left = paused ? Infinity : (api.sessionUsedAt() ?? now) + idleMinutes * MINUTE_MS - now
  const stay = (): void => void keepAlive().then(() => setNow(Date.now()))
  const warning = left <= WARNING_MS
  const over = left <= 0

  // When activity last asked, so a burst of keys sends one request, not one per key while the
  // first is still on its way.
  const askedAt = useRef(0)
  useEffect(() => {
    if (warning) {
      return
    }
    const onActivity = (): void => {
      if (Date.now() - Math.max(api.sessionUsedAt() ?? 0, askedAt.current) >= KEEP_ALIVE_MS) {
        askedAt.current = Date.now()
        void keepAlive()
      }
    }
    for (const type of ACTIVITY) {
      window.addEventListener(type, onActivity, { capture: true, passive: true })
    }
    return () => {
      for (const type of ACTIVITY) {
        window.removeEventListener(type, onActivity, { capture: true })
      }
    }
  }, [warning])

  // At the end, one last request lets Computer 1 end the session and record why; its 401 signs
  // this computer out with Computer 1's own words. When Computer 1 cannot be reached, this
  // computer signs out by itself.
  const ending = useRef(false)
  useEffect(() => {
    if (!over || ending.current) {
      return
    }
    ending.current = true
    void api.call('session').then(
      () => {
        ending.current = false
      },
      (error: unknown) => {
        ending.current = false
        if (error instanceof UnreachableError) {
          onEnd(errorMessage('SESSION_EXPIRED', { idleMinutes }))
        } else if (!isSessionGone(error)) {
          throw error
        }
      },
    )
  }, [over, idleMinutes, onEnd])

  return (
    <AlertDialog open={warning && !over}>
      <AlertDialogContent onEscapeKeyDown={stay}>
        <AlertDialogTitle>{words.title(countdown(left))}</AlertDialogTitle>
        <AlertDialogDescription>{words.text(idleMinutes - 1)}</AlertDialogDescription>
        <div className="flex gap-2">
          <AlertDialogCancel className="flex-1" onClick={onSignOut}>
            {words.signOut}
          </AlertDialogCancel>
          <AlertDialogAction className="flex-[1.4]" onClick={stay}>
            {words.stay}
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  )
}
