import { useState } from 'react'

import { bridge } from '../bridge.ts'
import { en } from '../i18n/en.ts'
import { PrinterList, receiptPrinter, usePrinterChoice } from '../printing/printer-choice.tsx'
import type { Chosen } from './Setup.tsx'
import { StepNav } from './StepNav.tsx'

const words = en.setup.printer

// Step 4. The printer for receipts. With no printer set up at all, setup can still finish, and
// each receipt opens the Windows print window.
export function ReceiptPrinterStep({ onBack, onFinish }: { onBack: () => void; onFinish: (chosen: Chosen) => void }) {
  const choice = usePrinterChoice()
  const [saving, setSaving] = useState(false)
  const { selected } = choice

  function onContinue(): void {
    if (selected === null) {
      onFinish({ printer: null, displayName: null })
      return
    }
    const printer = receiptPrinter(selected)
    setSaving(true)
    void bridge()
      .setPrinter(printer)
      .then(() => onFinish({ printer, displayName: selected.displayName }))
  }

  return (
    <>
      <section className="flex flex-col gap-5">
        <h1 className="font-display text-[34px] font-semibold">{words.title}</h1>
        <PrinterList choice={choice} emptyNote={words.finishWithout} />
        <p className="text-[13px] text-ink-muted">{words.testLater}</p>
      </section>
      <StepNav
        onBack={onBack}
        canContinue={choice.loaded && (selected !== null || choice.printers.length === 0) && !saving}
        label={en.setup.finish}
        onContinue={onContinue}
      />
    </>
  )
}
