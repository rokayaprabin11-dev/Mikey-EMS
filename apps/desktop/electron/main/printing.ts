import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as wait } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'

import { app, BrowserWindow, type WebContents, webFrameMain } from 'electron'

import type { Printer, PrintResult, ReceiptPrinter } from '../bridge.ts'
import { printInTurn } from './print-order.ts'

export async function listPrinters(contents: WebContents): Promise<Printer[]> {
  const printers = await contents.getPrintersAsync()
  return printers.map(({ name, displayName, description }) => ({ name, displayName, description }))
}

const OPEN_TIMEOUT_MS = 10_000
// After its frame has loaded, the PDF viewer needs a moment more before a print has the pages on
// it: in the printing spike (2026-11-01) prints made sooner than about 200 ms came out blank.
const SETTLE_MS = 500

// The PDF viewer shows a PDF in a frame of its own inside its extension's page. Once that frame
// has loaded, the document is open.
function pdfOpened(contents: WebContents, fileUrl: string): Promise<void> {
  return new Promise((resolve) => {
    const onFrame = (_event: unknown, isMainFrame: boolean, processId: number, routingId: number): void => {
      const frame = webFrameMain.fromId(processId, routingId)
      if (!isMainFrame && frame?.url === fileUrl && frame.parent?.url.startsWith('chrome-extension://') === true) {
        contents.off('did-frame-finish-load', onFrame)
        resolve()
      }
    }
    contents.on('did-frame-finish-load', onFrame)
  })
}

// Opens the PDF in a hidden window and prints it. The file is written to a folder of its own and
// removed straight after, so nothing stays on this computer.
export async function printPdf(bytes: Uint8Array, printer: ReceiptPrinter | null): Promise<PrintResult> {
  const folder = await mkdtemp(join(app.getPath('temp'), 'mikey-print-'))
  const file = join(folder, 'print.pdf')
  const window = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  const timeout = new AbortController()
  try {
    await writeFile(file, bytes)
    const opened = Promise.all([pdfOpened(window.webContents, pathToFileURL(file).href), window.loadFile(file)]).then(
      () => true,
    )
    const tooLong = wait(OPEN_TIMEOUT_MS, false, { signal: timeout.signal })
    if (!(await Promise.race([opened, tooLong]))) {
      return { printed: false, reason: `The PDF did not open for printing within ${OPEN_TIMEOUT_MS / 1000} seconds.` }
    }
    await wait(SETTLE_MS)
    return await printInTurn(
      (options) =>
        new Promise((resolve) => {
          window.webContents.print(options, (printed, reason) => resolve(printed ? { printed } : { printed, reason }))
        }),
      printer,
    )
  } finally {
    // Stops the timer; the race has already ended, so its rejection goes nowhere.
    timeout.abort()
    window.close()
    await rm(folder, { recursive: true, force: true })
  }
}
