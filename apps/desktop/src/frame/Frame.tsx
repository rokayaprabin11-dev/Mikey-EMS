import type { Session } from '@mikey/shared'
import { useEffect, useRef, useState } from 'react'

import { CollectFee } from '../collect/CollectFee.tsx'
import { type ChosenStudent, isSettled, useCollect, useSendAgainWhenBack } from '../collect/payment.tsx'
import { WaitingPayment } from '../collect/WaitingPayment.tsx'
import { Dashboard } from '../dashboard/Dashboard.tsx'
import { en } from '../i18n/en.ts'
import { PrinterDialog } from '../printing/PrinterDialog.tsx'
import { useSession } from '../session/session.tsx'
import { kathmanduHour } from '../today.ts'
import { useLink } from './link.tsx'
import { BUILT_IN, type Screen } from './screens.ts'
import { Sidebar } from './Sidebar.tsx'
import { TopBar } from './TopBar.tsx'
import { Unreachable } from './Unreachable.tsx'

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
  const collect = useCollect()
  const { pending, forgetDraft } = collect
  // A payment not finished at the last sign-out is where the app opens again.
  const [screen, setScreen] = useState<Screen>(() => (pending !== null && !isSettled(pending) ? 'collectFee' : 'dashboard'))
  const [printerOpen, setPrinterOpen] = useState(false)
  const search = useRef<HTMLInputElement>(null)

  useSendAgainWhenBack(session.user.id, link.last?.at ?? null)
  // Signing out leaves nothing of the form behind.
  useEffect(() => forgetDraft, [forgetDraft])

  // A student chosen anywhere opens Collect fee with them, unless a payment is not finished:
  // then Collect fee shows that payment, and nothing new can be started.
  function openCollect(student: ChosenStudent): void {
    collect.start(student)
    setScreen('collectFee')
  }

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
  const school = health?.db === 'ok' ? health.schoolName : null
  const firstName = session.user.fullName.trim().split(/\s+/)[0] ?? session.user.fullName
  const title =
    screen === 'dashboard' && health !== undefined
      ? words.dashboardTitle(kathmanduHour(new Date(health.time)), firstName)
      : words.screens[screen]
  const blocked = link.state === 'unavailable' && link.failing !== null ? link.failing : null
  const unconfirmed = pending !== null && (pending.stage.kind === 'sending' || pending.stage.kind === 'waiting') ? pending : null

  return (
    <>
      <div inert={blocked !== null} className="flex h-screen bg-paper text-ink">
        <Sidebar screen={screen} onOpen={setScreen} />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar
            title={title}
            subtitle={screen === 'dashboard' || screen === 'collectFee' ? words.dashboardSubtitle : words.counter}
            user={session.user}
            searchRef={search}
            onChooseStudent={(student) => openCollect({ ref: student, summary: student })}
            onPrinter={() => setPrinterOpen(true)}
            onSignOut={() => void signOut()}
          />
          <main className="flex-1 overflow-y-auto px-7 pt-5.5 pb-7">
            {screen === 'dashboard' && <Dashboard onOpen={setScreen} onCollect={(student) => openCollect({ ref: student, summary: null })} />}
            {screen === 'collectFee' && <CollectFee session={session} />}
            {screen !== 'dashboard' && screen !== 'collectFee' && <NotBuilt screen={screen} />}
          </main>
        </div>
      </div>
      <PrinterDialog open={printerOpen} onOpenChange={setPrinterOpen} />
      {blocked !== null && (
        <Unreachable
          link={{ ...link, failing: blocked }}
          school={school ?? en.appName}
          payment={unconfirmed === null ? null : <WaitingPayment pending={unconfirmed} lastSaved={collect.lastSaved} userId={session.user.id} />}
        />
      )}
    </>
  )
}
