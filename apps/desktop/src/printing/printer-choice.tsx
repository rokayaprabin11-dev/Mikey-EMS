import { useQuery } from '@tanstack/react-query'
import { Printer } from 'lucide-react'
import { useState } from 'react'

import type { Printer as PrinterInfo, ReceiptPrinter } from '../../electron/bridge.ts'
import { bridge } from '../bridge.ts'
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert.tsx'
import { Button } from '../components/ui/button.tsx'
import { RadioCard, RadioGroup } from '../components/ui/radio-group.tsx'
import { en } from '../i18n/en.ts'

const words = en.printer

export interface PrinterChoice {
  printers: PrinterInfo[]
  // What is picked now, else the saved printer while Windows still has it.
  selected: PrinterInfo | null
  loaded: boolean
  choose: (name: string) => void
  lookAgain: () => void
}

// The printers Windows knows, and which one takes receipts. Electron does not say which is the
// Windows default, so nothing is picked for the accountant.
export function usePrinterChoice(): PrinterChoice {
  const printers = useQuery({ queryKey: ['printers'], queryFn: () => bridge().listPrinters() })
  const saved = useQuery({ queryKey: ['printer'], queryFn: () => bridge().getPrinter() })
  const [choice, setChoice] = useState<string | null>(null)
  const list = printers.data ?? []
  const savedName = saved.data?.name ?? null
  return {
    printers: list,
    selected: list.find((printer) => printer.name === choice) ?? list.find((printer) => printer.name === savedName) ?? null,
    loaded: printers.isSuccess && saved.isSuccess,
    choose: setChoice,
    lookAgain: () => void printers.refetch(),
  }
}

// Receipts print on A5 only in this version (DOMAIN_RULES §5, default paper).
export function receiptPrinter(printer: PrinterInfo): ReceiptPrinter {
  return { name: printer.name, paper: 'A5' }
}

export function PrinterList({ choice, emptyNote }: { choice: PrinterChoice; emptyNote?: string }) {
  return (
    <>
      {choice.loaded && choice.printers.length === 0 && (
        <div className="flex flex-col items-start gap-4">
          <Alert variant="warn">
            <Printer aria-hidden="true" />
            <div>
              <AlertTitle>{words.none}</AlertTitle>
              <AlertDescription>{emptyNote === undefined ? words.noneHelp : `${words.noneHelp} ${emptyNote}`}</AlertDescription>
            </div>
          </Alert>
          <Button variant="secondary" onClick={choice.lookAgain}>
            {words.lookAgain}
          </Button>
        </div>
      )}
      {choice.printers.length > 0 && (
        <RadioGroup aria-label={words.label} value={choice.selected?.name ?? ''} onValueChange={choice.choose} className="gap-2">
          {choice.printers.map((printer) => (
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
    </>
  )
}
