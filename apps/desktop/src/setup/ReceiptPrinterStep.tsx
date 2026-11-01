import { useQuery } from '@tanstack/react-query'
import { Printer } from 'lucide-react'
import { useState } from 'react'

import { bridge } from '../bridge.ts'
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert.tsx'
import { Button } from '../components/ui/button.tsx'
import { RadioCard, RadioGroup } from '../components/ui/radio-group.tsx'
import { en } from '../i18n/en.ts'
import type { Chosen } from './Setup.tsx'
import { StepNav } from './StepNav.tsx'

const words = en.setup.printer

// Step 4. The printers Windows knows, to choose the one for receipts. Electron does not say
// which is the Windows default, so nothing is chosen until the accountant picks one. With no
// printer set up at all, setup can still finish, and each receipt opens the Windows print window.
export function ReceiptPrinterStep({ onBack, onFinish }: { onBack: () => void; onFinish: (chosen: Chosen) => void }) {
  const printers = useQuery({ queryKey: ['printers'], queryFn: () => bridge().listPrinters() })
  const saved = useQuery({ queryKey: ['printer'], queryFn: () => bridge().getPrinter() })
  const [choice, setChoice] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const list = printers.data ?? []
  const savedName = saved.data?.name ?? null
  const selected =
    list.find((printer) => printer.name === choice) ?? list.find((printer) => printer.name === savedName) ?? null
  const loaded = printers.isSuccess && saved.isSuccess

  function onContinue(): void {
    if (selected === null) {
      onFinish({ printer: null, displayName: null })
      return
    }
    const printer = { name: selected.name, paper: 'A5' } as const
    setSaving(true)
    void bridge()
      .setPrinter(printer)
      .then(() => onFinish({ printer, displayName: selected.displayName }))
  }

  return (
    <>
      <section className="flex flex-col gap-5">
        <h1 className="font-display text-[34px] font-semibold">{words.title}</h1>
        {loaded && list.length === 0 && (
          <div className="flex flex-col items-start gap-4">
            <Alert variant="warn">
              <Printer aria-hidden="true" />
              <div>
                <AlertTitle>{words.none}</AlertTitle>
                <AlertDescription>{words.noneHelp}</AlertDescription>
              </div>
            </Alert>
            <Button variant="secondary" onClick={() => void printers.refetch()}>
              {words.lookAgain}
            </Button>
          </div>
        )}
        {list.length > 0 && (
          <RadioGroup aria-label={words.label} value={selected?.name ?? ''} onValueChange={setChoice} className="gap-2">
            {list.map((printer) => (
              <RadioCard key={printer.name} value={printer.name} className="items-center rounded-lg px-4 py-3.5">
                <span className="flex flex-col gap-0.5">
                  <strong className="text-[15px]">{printer.displayName}</strong>
                  {printer.description !== '' && <span className="text-[13px] text-ink-muted">{printer.description}</span>}
                </span>
              </RadioCard>
            ))}
          </RadioGroup>
        )}
        <div className="flex max-w-80 flex-col gap-1.5 text-[13px]">
          <span className="font-semibold">{words.paper}</span>
          <span className="flex h-10.5 items-center rounded-md bg-neutral-tint px-3">{words.a5}</span>
          <span className="text-[12.5px] text-ink-muted">{words.paperHelp}</span>
        </div>
        <p className="text-[13px] text-ink-muted">{words.testLater}</p>
      </section>
      <StepNav
        onBack={onBack}
        canContinue={loaded && (selected !== null || list.length === 0) && !saving}
        label={en.setup.finish}
        onContinue={onContinue}
      />
    </>
  )
}
