import type { WebContentsPrintOptions } from 'electron'

import type { PrintResult, ReceiptPrinter } from '../bridge.ts'

export type Print = (options: WebContentsPrintOptions) => Promise<PrintResult>

// Without asking on the chosen printer; when there is none, or that fails (a printer that was
// removed, or a job Windows refused), the Windows print window, where another can be picked.
export async function printInTurn(print: Print, printer: ReceiptPrinter | null): Promise<PrintResult> {
  // A PDF page prints at its own size, with nothing added around it.
  const page = { pageSize: printer?.paper ?? 'A5', margins: { marginType: 'none' } } as const
  if (printer !== null) {
    const result = await print({ ...page, silent: true, deviceName: printer.name })
    if (result.printed) {
      return result
    }
  }
  return print({ ...page, silent: false })
}
