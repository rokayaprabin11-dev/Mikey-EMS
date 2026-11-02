import { useMutation } from '@tanstack/react-query'
import { CircleAlert, CircleCheck } from 'lucide-react'
import type { ReactNode } from 'react'

import { api } from '../api/client.ts'
import { bridge } from '../bridge.ts'
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert.tsx'
import { Button } from '../components/ui/button.tsx'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../components/ui/dialog.tsx'
import { problemOf } from '../connection.ts'
import { useLink } from '../frame/link.tsx'
import { en } from '../i18n/en.ts'
import { PrinterList, receiptPrinter, usePrinterChoice } from './printer-choice.tsx'

const words = en.printer

// "Printer" in the account menu: the printer for receipts, and a test print on it before saving
// (GET /receipts/test, which saves nothing and uses no receipt number).
function PrinterForm({ onDone }: { onDone: () => void }) {
  const link = useLink()
  const choice = usePrinterChoice()
  const { selected } = choice
  const test = useMutation({
    mutationFn: async () => {
      const pdf = await api.call('testReceipt')
      return bridge().printPdf(pdf, selected === null ? null : receiptPrinter(selected))
    },
  })
  const save = useMutation({
    mutationFn: () => (selected === null ? Promise.resolve() : bridge().setPrinter(receiptPrinter(selected))),
    onSuccess: onDone,
  })

  let result: ReactNode = null
  if (test.isError) {
    const problem = problemOf(test.error, link.address)
    result = (
      <Alert variant="bad">
        <CircleAlert aria-hidden="true" />
        <div>
          <AlertTitle>{problem.title}</AlertTitle>
          {problem.help !== null && <AlertDescription>{problem.help}</AlertDescription>}
        </div>
      </Alert>
    )
  } else if (test.isSuccess) {
    result = test.data.printed ? (
      <Alert variant="ok">
        <CircleCheck aria-hidden="true" />
        <AlertTitle>{words.testSent}</AlertTitle>
      </Alert>
    ) : (
      <Alert variant="bad">
        <CircleAlert aria-hidden="true" />
        <AlertTitle>{words.testFailed}</AlertTitle>
      </Alert>
    )
  }

  return (
    <>
      <DialogTitle>{words.title}</DialogTitle>
      <DialogDescription>{words.intro}</DialogDescription>
      <PrinterList choice={choice} />
      <div className="flex flex-col items-start gap-3">
        <Button variant="secondary" disabled={test.isPending} onClick={() => test.mutate()}>
          {test.isPending ? words.testing : words.testPrint}
        </Button>
        {result}
      </div>
      <div className="flex justify-end gap-2.5 border-t border-line pt-4">
        <Button variant="secondary" onClick={onDone}>
          {words.cancel}
        </Button>
        <Button disabled={selected === null || save.isPending} onClick={() => save.mutate()}>
          {words.save}
        </Button>
      </div>
    </>
  )
}

export function PrinterDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>{open && <PrinterForm onDone={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  )
}
