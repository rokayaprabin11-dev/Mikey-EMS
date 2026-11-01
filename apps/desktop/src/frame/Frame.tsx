import type { Session } from '@mikey/shared'
import { useEffect, useRef, useState } from 'react'

import { Dashboard } from '../dashboard/Dashboard.tsx'
import { en } from '../i18n/en.ts'
import { useSession } from '../session/session.tsx'
import { kathmanduHour } from '../today.ts'
import { useLink } from './link.tsx'
import { BUILT_IN, type Screen } from './screens.ts'
import { Sidebar } from './Sidebar.tsx'
import { TopBar } from './TopBar.tsx'

const words = en.frame

function NotBuilt({ screen }: { screen: Screen }) {
  return (
    <section className="flex max-w-160 flex-col gap-2 rounded-lg border border-line bg-surface px-6 py-5.5">
      <h2 className="font-display text-xl font-semibold">{words.screens[screen]}</h2>
      <p className="text-ink-soft">{words.notBuilt(BUILT_IN[screen] ?? '')}</p>
      <p className="text-ink-muted">{words.notBuiltHelp}</p>
    </section>
  )
}

// The signed-in app: the sidebar and the top bar around one screen at a time (no router), with
// F2 for Collect fee and Ctrl+K for the student search (docs/DESIGN_SYSTEM.md, Accessibility).
export function Frame({ session }: { session: Session }) {
  const { signOut } = useSession()
  const link = useLink()
  const [screen, setScreen] = useState<Screen>('dashboard')
  const search = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'F2') {
        event.preventDefault()
        setScreen('collectFee')
      } else if (event.ctrlKey && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        search.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const health = link.last?.check.health
  const firstName = session.user.fullName.trim().split(/\s+/)[0] ?? session.user.fullName
  const title =
    screen === 'dashboard' && health !== undefined
      ? words.dashboardTitle(kathmanduHour(new Date(health.time)), firstName)
      : words.screens[screen]

  return (
    <div className="flex h-screen bg-paper text-ink">
      <Sidebar screen={screen} onOpen={setScreen} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          title={title}
          subtitle={screen === 'dashboard' ? words.dashboardSubtitle : words.counter}
          user={session.user}
          searchRef={search}
          onChooseStudent={() => setScreen('students')}
          onSignOut={() => void signOut()}
        />
        <main className="flex-1 overflow-y-auto px-7 pt-5.5 pb-7">
          {screen === 'dashboard' ? <Dashboard onOpen={setScreen} /> : <NotBuilt screen={screen} />}
        </main>
      </div>
    </div>
  )
}
