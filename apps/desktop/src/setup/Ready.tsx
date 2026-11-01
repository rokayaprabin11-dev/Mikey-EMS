import { CircleCheck } from 'lucide-react'

import { addressOf } from '../../electron/server-address.ts'
import { Button } from '../components/ui/button.tsx'
import { en } from '../i18n/en.ts'
import type { Chosen, ServerInfo } from './Setup.tsx'

const words = en.setup.ready

// The end of setup: what this counter is now connected to and prints on.
export function Ready({
  serverUrl,
  server,
  chosen,
  onSignIn,
}: {
  serverUrl: string
  server: ServerInfo | null
  chosen: Chosen
  onSignIn: () => void
}) {
  const address = addressOf(serverUrl)
  return (
    <section className="flex flex-col gap-5">
      <CircleCheck aria-hidden="true" className="size-14 text-ok" strokeWidth={2} />
      <h1 className="font-display text-[40px] leading-[1.1] font-semibold">{words.title}</h1>
      <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2.5 rounded-lg border border-line bg-surface px-5 py-4.5 text-[15px]">
        <dt className="text-ink-muted">{words.connectedTo}</dt>
        <dd className="font-semibold">{server === null ? address : words.server(server.serverName, address)}</dd>
        <dt className="text-ink-muted">{words.printsOn}</dt>
        <dd className="font-semibold">
          {chosen.displayName === null ? words.printWindow : words.printer(chosen.displayName)}
        </dd>
        <dt className="text-ink-muted">{words.recordsKept}</dt>
        <dd className="font-semibold">{words.noRecords}</dd>
      </dl>
      <p className="text-[15px] leading-relaxed text-ink-soft">{words.signInHelp}</p>
      <Button size="xl" className="self-start" onClick={onSignIn}>
        {words.goToSignIn}
      </Button>
    </section>
  )
}
