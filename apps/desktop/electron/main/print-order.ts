import type { WebContentsPrintOptions } from 'electron'

import type { PrintResult, ReceiptPrinter } from '../bridge.ts'

export type Print = (options: WebContentsPrintOptions) => Promise<PrintResult>

// A PDF page prints at its own size, with nothing added around it.
function pageFor(printer: ReceiptPrinter | null) {
  return { pageSize: printer?.paper ?? 'A5', margins: { marginType: 'none' } } as const
}

// Without asking on the chosen printer, and nothing more: a receipt's original.
export function printSilently(print: Print, printer: ReceiptPrinter): Promise<PrintResult> {
  return print({ ...pageFor(printer), silent: true, deviceName: printer.name })
}

// Without asking on the chosen printer; when there is none, or that fails (a printer that was
// removed, or a job Windows refused), the Windows print window, where another can be picked.
export async function printInTurn(print: Print, printer: ReceiptPrinter | null): Promise<PrintResult> {
  if (printer !== null) {
    const result = await printSilently(print, printer)
    if (result.printed) {
      return result
    }
  }
  return print({ ...pageFor(printer), silent: false })
}
