import type { WebContentsPrintOptions } from 'electron'
import { describe, expect, it } from 'vitest'

import type { PrintResult } from '../electron/bridge.ts'
import { printInTurn } from '../electron/main/print-order.ts'

// A print that answers in turn with the given results, and remembers what it was asked.
function printer(...results: PrintResult[]) {
  const asked: WebContentsPrintOptions[] = []
  const print = (options: WebContentsPrintOptions): Promise<PrintResult> => {
    asked.push(options)
    const result = results.shift()
    if (result === undefined) {
      throw new Error('Printed more often than expected.')
    }
    return Promise.resolve(result)
  }
  return { print, asked }
}

const RECEIPT_PRINTER = { name: 'EPSON L3150', paper: 'A5' } as const
const PAGE = { pageSize: 'A5', margins: { marginType: 'none' } }

describe('printing a PDF', () => {
  it('prints on the chosen printer without asking', async () => {
    const { print, asked } = printer({ printed: true })
    expect(await printInTurn(print, RECEIPT_PRINTER)).toEqual({ printed: true })
    expect(asked).toEqual([{ ...PAGE, silent: true, deviceName: 'EPSON L3150' }])
  })

  it('opens the Windows print window when the chosen printer fails', async () => {
    const { print, asked } = printer({ printed: false, reason: 'Invalid deviceName provided' }, { printed: true })
    expect(await printInTurn(print, RECEIPT_PRINTER)).toEqual({ printed: true })
    expect(asked).toEqual([{ ...PAGE, silent: true, deviceName: 'EPSON L3150' }, { ...PAGE, silent: false }])
  })

  it('opens the Windows print window when no printer is chosen', async () => {
    const { print, asked } = printer({ printed: true })
    expect(await printInTurn(print, null)).toEqual({ printed: true })
    expect(asked).toEqual([{ ...PAGE, silent: false }])
  })

  it('says it failed when the print window is closed without printing too', async () => {
    const { print } = printer({ printed: false, reason: 'Print job failed' }, { printed: false, reason: 'Print job canceled' })
    expect(await printInTurn(print, RECEIPT_PRINTER)).toEqual({ printed: false, reason: 'Print job canceled' })
  })
})
