// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { openAccountMenu, showSignedIn } from '../testing/app.tsx'
import { computer1WithSignIn, fakeBridge, TEST_PDF } from '../testing/fake-bridge.ts'

afterEach(cleanup)

const PRINTERS = [
  { name: 'EPSON_L3150', displayName: 'EPSON L3150 Series', description: 'Front office' },
  { name: 'Microsoft Print to PDF', displayName: 'Microsoft Print to PDF', description: '' },
]

function setUp() {
  return fakeBridge({ serverUrl: 'http://192.168.1.10:3100', printers: PRINTERS, answer: computer1WithSignIn().answer })
}

describe('the Printer item of the account menu', () => {
  it('chooses the receipt printer, prints a test receipt on it, and saves it', async () => {
    const bridge = setUp()
    bridge.saved.printer = { name: 'Microsoft Print to PDF', paper: 'A5' }
    await showSignedIn()
    await openAccountMenu('Printer')
    const dialog = within(await screen.findByRole('dialog', { name: 'Receipt printer' }))
    expect(dialog.getByRole('radio', { name: /Microsoft Print to PDF/ }).getAttribute('aria-checked')).toBe('true')
    expect(dialog.getByText('A5 sheet')).toBeTruthy()

    fireEvent.click(dialog.getByRole('radio', { name: /EPSON L3150 Series/ }))
    fireEvent.click(dialog.getByRole('button', { name: 'Print a test receipt' }))
    expect(await dialog.findByText('Test receipt sent to the printer.')).toBeTruthy()
    expect(bridge.printPdf).toHaveBeenCalledWith(TEST_PDF, { name: 'EPSON_L3150', paper: 'A5' })
    // A test print does not change the saved printer.
    expect(bridge.saved.printer).toEqual({ name: 'Microsoft Print to PDF', paper: 'A5' })

    fireEvent.click(dialog.getByRole('button', { name: 'Save printer' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(bridge.saved.printer).toEqual({ name: 'EPSON_L3150', paper: 'A5' })
  })

  it('says when the test receipt did not print, and changes nothing on Cancel', async () => {
    const bridge = setUp()
    bridge.printPdf.mockResolvedValue({ printed: false, reason: 'Print job canceled' })
    await showSignedIn()
    await openAccountMenu('Printer')
    const dialog = within(await screen.findByRole('dialog', { name: 'Receipt printer' }))
    fireEvent.click(dialog.getByRole('radio', { name: /EPSON L3150 Series/ }))
    fireEvent.click(dialog.getByRole('button', { name: 'Print a test receipt' }))
    expect(await dialog.findByText('The test receipt did not print. Check that the printer is on and has paper, then try again.')).toBeTruthy()
    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(bridge.saved.printer).toBeNull()
  })
})
