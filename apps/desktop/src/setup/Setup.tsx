import { useQuery } from '@tanstack/react-query'
import { cn } from 'cn'
import { Check } from 'lucide-react'
import { type ReactNode, useState } from 'react'

import type { ReceiptPrinter } from '../../electron/bridge.ts'
import { bridge } from '../bridge.ts'
import { Crest } from '../components/Crest.tsx'
import { en } from '../i18n/en.ts'
import { FindComputer1 } from './FindComputer1.tsx'
import { GetAllowed } from './GetAllowed.tsx'
import { Ready } from './Ready.tsx'
import { ReceiptPrinterStep } from './ReceiptPrinterStep.tsx'
import { WhichComputer } from './WhichComputer.tsx'

const words = en.setup

// The steps in the rail; the last, Ready, has no number.
const STEPS = 4
type Step = 0 | 1 | 2 | 3 | 4

// What Computer 1 said about itself, for the rail and the Ready page.
export interface ServerInfo {
  serverName: string
  schoolName: string | null
}

export interface Chosen {
  printer: ReceiptPrinter | null
  // The name shown for it, which can differ from its Windows name.
  displayName: string | null
}

function Rail({ step, onGoTo }: { step: Step; onGoTo: (step: Step) => void }) {
  return (
    <ol aria-label={words.steps} className="flex flex-col gap-1">
      {words.rail.map((label, index) => {
        const done = index < step
        const current = index === step
        return (
          <li key={label}>
            <button
              type="button"
              disabled={index > step}
              aria-current={current ? 'step' : undefined}
              onClick={() => onGoTo(index as Step)}
              className={cn(
                'flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-md px-2.5 text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-surface disabled:cursor-default',
                current && 'bg-chrome-accountant-active font-semibold',
                index > step ? 'text-surface/70' : 'text-surface',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'grid size-6 flex-none place-items-center rounded-full text-xs font-semibold',
                  done && 'bg-ok-tint text-ok',
                  current && 'bg-surface text-chrome-accountant',
                  !done && !current && 'text-surface/70',
                )}
              >
                {done ? <Check className="size-3.5" strokeWidth={3} /> : index < STEPS ? index + 1 : ''}
              </span>
              {label}
            </button>
          </li>
        )
      })}
    </ol>
  )
}

// First-time setup of Computer 2: which computer this is, where Computer 1 is, being allowed by
// it, and the receipt printer. `startAt` is "get-allowed" when this computer was set up before
// but Computer 1 no longer allows it.
export function Setup({ startAt, onDone }: { startAt: 'setup' | 'get-allowed'; onDone: () => void }) {
  const [step, setStep] = useState<Step>(startAt === 'get-allowed' ? 2 : 0)
  const [server, setServer] = useState<ServerInfo | null>(null)
  const [chosen, setChosen] = useState<Chosen>({ printer: null, displayName: null })
  const saved = useQuery({ queryKey: ['server-url'], queryFn: () => bridge().getServerUrl() })
  const serverUrl = saved.data ?? null

  let content: ReactNode = null
  if (saved.isSuccess) {
    if (step === 0) {
      content = <WhichComputer onContinue={() => setStep(1)} />
    } else if (step === 1) {
      content = (
        <FindComputer1
          savedUrl={serverUrl}
          onBack={() => setStep(0)}
          onConnected={(info) => {
            setServer(info)
            void saved.refetch().then(() => setStep(2))
          }}
        />
      )
    } else if (serverUrl === null) {
      throw new Error(`Setup reached step ${step + 1} before a server address was saved.`)
    } else if (step === 2) {
      content = (
        <GetAllowed
          serverUrl={serverUrl}
          onBack={() => setStep(1)}
          onContinue={(info) => {
            setServer(info)
            setStep(3)
          }}
        />
      )
    } else if (step === 3) {
      content = (
        <ReceiptPrinterStep
          onBack={() => setStep(2)}
          onFinish={(choice) => {
            setChosen(choice)
            setStep(4)
          }}
        />
      )
    } else {
      content = <Ready serverUrl={serverUrl} server={server} chosen={chosen} onSignIn={onDone} />
    }
  }

  return (
    <div className="flex min-h-screen flex-wrap bg-paper text-ink">
      <aside className="flex max-w-full flex-[1_1_300px] flex-col gap-8 bg-chrome-accountant px-7 py-9 text-surface">
        <div className="flex items-center gap-3">
          <Crest width={40} />
          <div className="flex flex-col gap-0.5">
            <span className="font-display text-lg leading-[1.1] font-semibold">{server?.schoolName ?? en.appName}</span>
            <span className="text-[12.5px] text-surface/70">{words.heading}</span>
          </div>
        </div>
        <Rail step={step} onGoTo={setStep} />
        <p className="mt-auto text-[12.5px] leading-normal text-surface/70">{words.firstComputer1}</p>
      </aside>

      <main className="flex min-w-0 flex-[999_1_560px] justify-center px-7 pt-12 pb-10">
        <div className="flex w-full max-w-170 flex-col gap-6">
          {step < STEPS && <p className="text-[13px] text-ink-muted">{words.stepOf(step + 1)}</p>}
          {content}
        </div>
      </main>
    </div>
  )
}
