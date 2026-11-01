import { formatKathmanduTime } from '@mikey/shared'
import { MonitorX } from 'lucide-react'

import { Crest } from '../components/Crest.tsx'
import { Button } from '../components/ui/button.tsx'
import { en } from '../i18n/en.ts'
import type { Link } from './link.tsx'

const words = en.unreachable

// Shown over the app once Computer 1 has not answered for 15 seconds (ARCHITECTURE.md, Health
// and connection status). The app stays as it was underneath and comes back by itself when
// Computer 1 answers again.
export function Unreachable({ link, school }: { link: Link & { failing: NonNullable<Link['failing']> }; school: string }) {
  const { failing } = link
  // No reply at all gets the design's own words and the checks; a reply that cannot be used
  // (its database has stopped, or a different version) says what it is.
  const noReply = failing.problem.kind === 'unreachable'
  return (
    <div role="alertdialog" aria-modal="true" aria-labelledby="unreachable-title" className="fixed inset-0 z-40 flex flex-col overflow-y-auto bg-paper text-ink">
      <header className="flex h-15 flex-none items-center justify-between gap-4 bg-chrome-accountant px-7 text-surface">
        <div className="flex items-center gap-3">
          <Crest width={28} />
          <span className="font-display text-lg font-semibold">{school}</span>
        </div>
        <span className="rounded-full bg-bad-tint px-3.5 py-1.5 text-[13px] font-semibold text-bad">
          {words.since(formatKathmanduTime(new Date(failing.since)))}
        </span>
      </header>
      <main className="flex flex-wrap items-start gap-7 px-7 py-12 lg:px-[8%]">
        <section className="flex flex-[2_1_30rem] flex-col items-start gap-5 rounded-xl border-2 border-bad bg-surface p-8">
          <MonitorX aria-hidden="true" className="size-11 text-bad" strokeWidth={1.75} />
          <h2 id="unreachable-title" className="font-display text-[40px] leading-[1.1] font-semibold">
            {noReply ? words.title : failing.problem.title}
          </h2>
          <p className="max-w-160 text-[17px] leading-relaxed text-ink-soft">{noReply ? words.intro : failing.problem.help}</p>
          <div className="mt-2 flex flex-wrap items-center gap-4">
            <Button size="xl" autoFocus onClick={link.retry}>
              {words.tryAgain}
            </Button>
            <span className="text-[13.5px] text-ink-muted">{words.trying(failing.attempts)}</span>
          </div>
        </section>
        {noReply && (
          <aside className="flex flex-[1_1_18rem] flex-col gap-4">
            <h3 className="font-display text-xl font-semibold">{words.checkThese}</h3>
            <ol className="flex list-decimal flex-col gap-3 pl-5 text-[15px] leading-normal">
              {words.checks.map((check) => (
                <li key={check}>{check}</li>
              ))}
            </ol>
            <p className="rounded-lg border border-line bg-surface p-4 text-[13.5px] leading-normal text-ink-soft">{words.noInternet}</p>
          </aside>
        )}
      </main>
    </div>
  )
}
