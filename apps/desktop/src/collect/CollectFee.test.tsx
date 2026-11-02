// @vitest-environment happy-dom
import { errorMessage } from '@mikey/shared'
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ServerRequest } from '../../electron/bridge.ts'
import { showSignedIn } from '../testing/app.tsx'
import { BIBEK, BIBEK_DUES, computer1TakingFees, LATE_FINE, paymentsSent } from '../testing/collect-server.ts'
import { fakeBridge, json, PASSWORD } from '../testing/fake-bridge.ts'
import { hasFocus, press, tab, type } from '../testing/keyboard.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

// /health is asked every 5 seconds (ARCHITECTURE.md, Health and connection status).
const CHECK = 5_000

const [ASHWIN, FINE, KARTIK] = BIBEK_DUES.map((due) => ({
  kind: due.kind,
  ...(due.kind === 'fee' ? { feeDueId: due.feeDueId } : { fineId: due.fineId }),
}))

async function atTheCounter() {
  const server = computer1TakingFees()
  const bridge = fakeBridge({ serverUrl: 'http://192.168.1.10:3100', answer: server.answer })
  bridge.saved.printer = { name: 'EPSON-L3250', paper: 'A5' }
  await showSignedIn()
  return { server, bridge }
}

// F2, then Bibek Lama from the search, as the accountant does it.
async function chooseBibek(): Promise<void> {
  fireEvent.keyDown(window, { key: 'F2' })
  const search = await screen.findByRole('combobox', { name: 'Find student' })
  fireEvent.focus(search)
  fireEvent.change(search, { target: { value: 'bibek' } })
  await screen.findByRole('option', { name: /Bibek Lama/ })
  fireEvent.keyDown(search, { key: 'Enter' })
  await screen.findByRole('checkbox', { name: 'Pay Monthly tuition, Ashwin 2083' })
}

function tick(label: string): void {
  fireEvent.click(screen.getByRole('checkbox', { name: `Pay ${label}` }))
}

async function reviewAndConfirm(amount: string): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: `Review ${amount} payment` }))
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm and print' }))
}

function rowText(label: string): string | null | undefined {
  return screen.getByText(label).parentElement?.textContent
}

function sentTo(sent: readonly ServerRequest[], path: RegExp): ServerRequest[] {
  return sent.filter((request) => path.test(request.path))
}

async function waitForChecks(count: number): Promise<void> {
  for (let check = 0; check < count; check += 1) {
    await act(() => vi.advanceTimersByTimeAsync(CHECK))
  }
}

describe('Collect fee', () => {
  it("opens with F2 on its search, and shows the student's dues oldest first in the server's words", async () => {
    await atTheCounter()
    fireEvent.keyDown(window, { key: 'F2' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Collect fee' })).toBeTruthy()
    const search = screen.getByRole('combobox', { name: 'Find student' })
    await waitFor(() => expect(hasFocus(search)).toBe(true))
    expect(screen.getByText('F2 from any screen')).toBeTruthy()
    expect(screen.getByText('Find a student to see the receipt here.')).toBeTruthy()

    type('bibek')
    await screen.findByRole('option', { name: /Bibek Lama/ })
    press('Enter')
    const first = await screen.findByRole('checkbox', { name: 'Pay Monthly tuition, Ashwin 2083' })
    await waitFor(() => expect(hasFocus(first)).toBe(true))

    expect(screen.getByText('MEMS-2076-0098, Class 7 A, roll 17. Guardian Pasang Lama, 98600 12884')).toBeTruthy()
    expect(screen.queryByText('Fee history')).toBeNull()
    expect(screen.getAllByRole('checkbox').map((box) => box.closest('li')?.textContent)).toEqual([
      'Monthly tuition, Ashwin 2083Overdue since 15 Ashwin 2083. Rs. 2,000 paid beforeof Rs. 1,680Rs.',
      'Late fine, Ashwin 2083Only the Super Admin can waive a fineof Rs. 100Rs.',
      'Monthly tuition, Kartik 2083Due by 15 Kartik 2083. Rs. 320 discount or scholarshipof Rs. 3,680Rs.',
    ])
    expect(screen.getByText('Overdue since 15 Ashwin 2083. Rs. 2,000 paid before').className).toContain('text-warn')
    expect(screen.getByText('Tick the dues the parent is paying.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Review payment' }).hasAttribute('disabled')).toBe(true)
  })

  it("shows the money as Computer 1 works it out, and works out only the change itself", async () => {
    const { server, bridge } = await atTheCounter()
    await chooseBibek()
    tick('Monthly tuition, Ashwin 2083')
    tick('Late fine, Ashwin 2083')
    tick('Monthly tuition, Kartik 2083')
    await screen.findByRole('button', { name: 'Review Rs. 5,460 payment' })

    const [asked] = sentTo(bridge.sent, /^\/payments\/preview$/).slice(-1)
    expect(JSON.parse(asked?.body ?? '')).toEqual({
      studentId: BIBEK.id,
      allocations: [
        { ...ASHWIN, amount: 168_000 },
        { ...FINE, amount: 10_000 },
        { ...KARTIK, amount: 368_000 },
      ],
    })
    // Every number and word below is the reply's.
    expect(server.fees.previews.at(-1)).toEqual({
      months: 'Ashwin and Kartik 2083',
      lines: [
        { label: 'Monthly tuition, Ashwin 2083 (balance)', amount: 168_000 },
        { label: 'Late fine, Ashwin 2083', amount: 10_000 },
        { label: 'Monthly tuition, Kartik 2083', amount: 368_000 },
      ],
      totals: { duesBefore: 546_000, discount: 32_000, amountPaid: 546_000, balanceAfter: 0 },
      amountInWords: 'Rupees Five Thousand Four Hundred Sixty Only',
    })
    const receipt = within(screen.getByRole('region', { name: 'Receipt preview' }))
    expect(receipt.getByText('Mikey English Medium School')).toBeTruthy()
    expect(receipt.getByText('No. given on save')).toBeTruthy()
    expect(receipt.getByText('12 Kartik 2083 (29 Oct 2026)')).toBeTruthy()
    expect(receipt.getByText('Bibek Lama').parentElement?.textContent).toBe('Bibek Lama, Class 7 A, roll 17')
    expect(receipt.getByText('For the months of Ashwin and Kartik 2083')).toBeTruthy()
    expect(receipt.getAllByRole('listitem').map((line) => line.textContent)).toEqual([
      'Monthly tuition, Ashwin 2083 (balance)Rs. 1,680',
      'Late fine, Ashwin 2083Rs. 100',
      'Monthly tuition, Kartik 2083Rs. 3,680',
    ])
    expect(rowText('Dues before this payment')).toBe('Dues before this paymentRs. 5,460')
    expect(rowText('Discount or scholarship')).toBe('Discount or scholarshipRs. 320')
    expect(rowText('Paying now')).toBe('Paying nowRs. 5,460')
    expect(rowText('Still due after this')).toBe('Still due after thisRs. 0')
    expect(receipt.getByText('Rupees Five Thousand Four Hundred Sixty Only')).toBeTruthy()
    expect(receipt.getByText('Paid by Cash')).toBeTruthy()
    expect(receipt.getByText('Received by Bikash Thapa')).toBeTruthy()

    const cash = screen.getByRole('textbox', { name: 'Cash received' })
    fireEvent.change(cash, { target: { value: '5000' } })
    expect(screen.getByText('Short by Rs. 460').className).toContain('text-bad')
    expect(screen.getByRole('button', { name: 'Review Rs. 5,460 payment' }).hasAttribute('disabled')).toBe(true)
    fireEvent.change(cash, { target: { value: '6000' } })
    expect(screen.getByText('Return Rs. 540 to the parent')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Review Rs. 5,460 payment' }).hasAttribute('disabled')).toBe(false)
    fireEvent.change(cash, { target: { value: '5,460' } })
    expect(screen.getByText('No change to give back.')).toBeTruthy()
    fireEvent.change(cash, { target: { value: 'six thousand' } })
    expect(screen.getByText('Type the amount in rupees, for example 6000.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Review Rs. 5,460 payment' }).hasAttribute('disabled')).toBe(true)
    // The cash received is never sent.
    expect(bridge.sent.some((request) => request.body?.includes('6000') === true)).toBe(false)
  })

  it('takes a part payment: the amount can be changed, and the receipt says what is still due', async () => {
    await atTheCounter()
    await chooseBibek()
    tick('Monthly tuition, Kartik 2083')
    const amount = screen.getByRole<HTMLInputElement>('textbox', { name: 'Amount for Monthly tuition, Kartik 2083' })
    expect(amount.value).toBe('3680')

    fireEvent.change(amount, { target: { value: '2000' } })
    await screen.findByRole('button', { name: 'Review Rs. 2,000 payment' })
    const receipt = within(screen.getByRole('region', { name: 'Receipt preview' }))
    expect(receipt.getAllByRole('listitem').map((line) => line.textContent)).toEqual(['Monthly tuition, Kartik 2083 (part)Rs. 2,000'])
    expect(rowText('Still due after this')).toBe('Still due after thisRs. 3,460')
    expect(screen.getByText('Still due after this').parentElement?.className).toContain('text-warn')

    fireEvent.change(amount, { target: { value: '0' } })
    expect(screen.getByText('Type an amount above Rs. 0, or untick this due.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Review payment' }).hasAttribute('disabled')).toBe(true)
    fireEvent.change(amount, { target: { value: '20 rupees' } })
    expect(screen.getByText('Type the amount in rupees, for example 1680.')).toBeTruthy()
    fireEvent.change(amount, { target: { value: '4000' } })
    expect(
      await screen.findByText('Rs. 4,000 is more than the Rs. 3,680 still due on Monthly tuition, Kartik 2083. Advance payments are not taken.'),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Review payment' }).hasAttribute('disabled')).toBe(true)
  })

  it('can be done from start to end with the keyboard only', async () => {
    const { server, bridge } = await atTheCounter()
    press('F2')
    const search = await screen.findByRole('combobox', { name: 'Find student' })
    await waitFor(() => expect(hasFocus(search)).toBe(true))
    type('bibek')
    await screen.findByRole('option', { name: /Bibek Lama/ })
    press('Enter')

    const ashwin = await screen.findByRole('checkbox', { name: 'Pay Monthly tuition, Ashwin 2083' })
    await waitFor(() => expect(hasFocus(ashwin)).toBe(true))
    press(' ')
    expect(ashwin.getAttribute('aria-checked')).toBe('true')
    tab()
    expect(hasFocus(screen.getByRole('textbox', { name: 'Amount for Monthly tuition, Ashwin 2083' }))).toBe(true)
    tab()
    press(' ')
    tab()
    tab()
    expect(hasFocus(screen.getByRole('checkbox', { name: 'Pay Monthly tuition, Kartik 2083' }))).toBe(true)
    press(' ')
    tab()
    type('2000')
    tab()
    expect(hasFocus(screen.getByRole('radio', { name: 'Cash' }))).toBe(true)
    tab()
    expect(hasFocus(screen.getByRole('textbox', { name: 'Cash received' }))).toBe(true)
    type('4000')
    expect(await screen.findByText('Return Rs. 220 to the parent')).toBeTruthy()
    await screen.findByRole('button', { name: 'Review Rs. 3,780 payment' })

    press('Enter', { ctrlKey: true })
    expect(screen.getByRole('heading', { name: 'Collect Rs. 3,780 by cash?' })).toBeTruthy()
    expect(screen.getByText(/^From Bibek Lama, Class 7 A\. A saved receipt cannot be edited\./)).toBeTruthy()
    await waitFor(() => expect(hasFocus(screen.getByRole('button', { name: 'Confirm and print' }))).toBe(true))
    press('Escape')
    const review = screen.getByRole('button', { name: 'Review Rs. 3,780 payment' })
    await waitFor(() => expect(hasFocus(review)).toBe(true))
    press('Enter', { ctrlKey: true })
    await waitFor(() => expect(hasFocus(screen.getByRole('button', { name: 'Confirm and print' }))).toBe(true))
    press('Enter', { ctrlKey: true })

    expect(await screen.findByText('Payment saved. Receipt 2083/84-001285 sent to the printer.')).toBeTruthy()
    const next = screen.getByRole('button', { name: 'Next student' })
    await waitFor(() => expect(hasFocus(next)).toBe(true))
    press('Enter')
    await waitFor(() => expect(hasFocus(screen.getByRole('combobox', { name: 'Find student' }))).toBe(true))

    const [payment, ...more] = paymentsSent(bridge.sent)
    expect(more).toEqual([])
    expect(payment?.studentId).toBe(BIBEK.id)
    expect(payment?.method).toBe('cash')
    expect(payment?.reference).toBeUndefined()
    expect(payment?.allocations).toEqual([
      { ...ASHWIN, amount: 168_000 },
      { ...FINE, amount: 10_000 },
      { ...KARTIK, amount: 200_000 },
    ])
    expect(server.fees.saved.size).toBe(1)
    expect(bridge.printPdf).toHaveBeenCalledTimes(1)
    expect(bridge.printPdf.mock.calls[0]?.[1]).toEqual({ name: 'EPSON-L3250', paper: 'A5' })
  })

  it('sends one request when Confirm and print is clicked twice', async () => {
    const { bridge } = await atTheCounter()
    await chooseBibek()
    tick('Late fine, Ashwin 2083')
    fireEvent.click(await screen.findByRole('button', { name: 'Review Rs. 100 payment' }))
    const confirm = await screen.findByRole('button', { name: 'Confirm and print' })
    act(() => {
      confirm.click()
      confirm.click()
    })
    expect(await screen.findByText('Payment saved. Receipt 2083/84-001285 sent to the printer.')).toBeTruthy()
    expect(paymentsSent(bridge.sent)).toHaveLength(1)
  })

  it('sends a payment whose answer was lost again with the same key, so it is saved once', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { server, bridge } = await atTheCounter()
    await chooseBibek()
    tick('Monthly tuition, Ashwin 2083')
    tick('Late fine, Ashwin 2083')
    tick('Monthly tuition, Kartik 2083')
    server.fees.loseNextReply = true
    await reviewAndConfirm('Rs. 5,460')

    expect(await screen.findByText("Not confirmed yet. Don't hand over a receipt.")).toBeTruthy()
    expect(
      screen.getByText(
        'Bibek Lama, Class 7 A, Rs. 5,460 cash. Keep the cash aside. The payment is sent again by itself when Computer 1 answers, then you see the receipt or the reason it failed. Do not enter it a second time.',
      ),
    ).toBeTruthy()
    // The form stays as it was, and cannot be changed.
    const ashwin = screen.getByRole('checkbox', { name: 'Pay Monthly tuition, Ashwin 2083' })
    expect(ashwin.getAttribute('aria-checked')).toBe('true')
    expect(ashwin.closest('[inert]')).not.toBeNull()
    expect(screen.queryByRole('button', { name: /^Review/ })).toBeNull()
    // Closing the app now asks first, with Stay as the default.
    expect(bridge.setCloseWarning).toHaveBeenLastCalledWith({
      message: 'A payment is waiting for Computer 1. If you close now it is forgotten. Close anyway?',
      stay: 'Stay',
      close: 'Close anyway',
    })

    await waitForChecks(1)
    expect(await screen.findByText('Payment saved. Receipt 2083/84-001285 sent to the printer.')).toBeTruthy()
    expect(bridge.setCloseWarning).toHaveBeenLastCalledWith(null)
    const sent = paymentsSent(bridge.sent)
    expect(sent).toHaveLength(2)
    expect(sent[1]).toEqual(sent[0])
    expect(server.fees.saved.size).toBe(1)
    expect(bridge.printPdf).toHaveBeenCalledTimes(1)
  })

  it('lets nobody enter the same payment again while one is not confirmed', async () => {
    const { server, bridge } = await atTheCounter()
    await chooseBibek()
    tick('Monthly tuition, Ashwin 2083')
    server.fees.refuseNext = json(500, { error: { code: 'INTERNAL_ERROR', message: errorMessage('INTERNAL_ERROR'), details: {} } })
    await reviewAndConfirm('Rs. 1,680')

    expect(await screen.findByText("Not confirmed yet. Don't hand over a receipt.")).toBeTruthy()
    expect(
      screen.getByText(
        'Bibek Lama, Class 7 A, Rs. 1,680 cash. Keep the cash aside. Something went wrong on Computer 1. Try again. If it happens again, tell the Super Admin. The payment may or may not be saved. Send it again: if it was saved, you get its receipt, and it is never saved twice.',
      ),
    ).toBeTruthy()

    // Choosing the student again, from the top bar or a dues row on the dashboard, shows the same
    // payment, and the form stays locked.
    const topSearch = screen.getByRole('combobox', { name: 'Search students' })
    fireEvent.focus(topSearch)
    fireEvent.change(topSearch, { target: { value: 'bibek' } })
    await screen.findByRole('option', { name: /Bibek Lama/ })
    fireEvent.keyDown(topSearch, { key: 'Enter' })
    expect(screen.getByText("Not confirmed yet. Don't hand over a receipt.")).toBeTruthy()
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Main menu' })).getByRole('button', { name: 'Dashboard' }))
    fireEvent.click(await screen.findByRole('button', { name: /^Bibek Lama/ }))
    expect(await screen.findByText("Not confirmed yet. Don't hand over a receipt.")).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: 'Pay Monthly tuition, Ashwin 2083' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('checkbox', { name: 'Pay Late fine, Ashwin 2083' }).closest('[inert]')).not.toBeNull()
    expect(paymentsSent(bridge.sent)).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Send again' }))
    expect(await screen.findByText('Payment saved. Receipt 2083/84-001285 sent to the printer.')).toBeTruthy()
    const sent = paymentsSent(bridge.sent)
    expect(sent).toHaveLength(2)
    expect(sent[1]?.idempotencyKey).toBe(sent[0]?.idempotencyKey)
    expect(server.fees.saved.size).toBe(1)
  })

  it('keeps a payment through a long outage and sends it again after signing in, with the same key', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { server, bridge } = await atTheCounter()
    await chooseBibek()
    tick('Late fine, Ashwin 2083')
    await reviewAndConfirm('Rs. 100')
    await screen.findByText('Payment saved. Receipt 2083/84-001285 sent to the printer.')
    fireEvent.click(screen.getByRole('button', { name: 'Next student' }))

    await chooseBibek()
    tick('Monthly tuition, Ashwin 2083')
    fireEvent.click(await screen.findByRole('button', { name: 'Review Rs. 1,680 payment' }))
    server.state.reachable = false
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm and print' }))
    expect(await screen.findByText("Not confirmed yet. Don't hand over a receipt.")).toBeTruthy()

    // The Can't reach Computer 1 screen says the same, with the last payment that was saved.
    await waitForChecks(4)
    const blocked = within(screen.getByRole('alertdialog', { name: "Can't reach Computer 1" }))
    expect(blocked.getByText("Not confirmed yet. Don't hand over a receipt.")).toBeTruthy()
    expect(blocked.getByText(/^Bibek Lama, Class 7 A, Rs\. 1,680 cash\. Keep the cash aside\./)).toBeTruthy()
    expect(blocked.getByText('Last confirmed save: receipt 2083/84-001285 at 10:58 AM.')).toBeTruthy()

    // No sign-out by this computer while the payment waits, however long Computer 1 is away.
    vi.setSystemTime(Date.now() + 20 * 60_000)
    await act(() => vi.advanceTimersByTimeAsync(1_000))
    expect(screen.queryByLabelText('Password')).toBeNull()
    expect(blocked.getByText("Not confirmed yet. Don't hand over a receipt.")).toBeTruthy()

    // Computer 1 is back, but it ended the session meanwhile: sign in, and the payment goes.
    server.state.ended = true
    server.state.reachable = true
    await waitForChecks(1)
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: PASSWORD } })
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'bikash.acc' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('Payment saved. Receipt 2083/84-001286 sent to the printer.')).toBeTruthy()

    const [fine, ...ashwin] = paymentsSent(bridge.sent)
    expect(fine?.allocations).toEqual([{ ...FINE, amount: 10_000 }])
    expect(ashwin.length).toBeGreaterThanOrEqual(2)
    expect(new Set(ashwin.map((payment) => payment.idempotencyKey)).size).toBe(1)
    expect(server.fees.saved.size).toBe(2)
  })

  it('says why Computer 1 refused, and reads the dues again after DUE_ALREADY_PAID', async () => {
    const { server, bridge } = await atTheCounter()
    await chooseBibek()
    tick('Monthly tuition, Ashwin 2083')
    tick('Late fine, Ashwin 2083')
    tick('Monthly tuition, Kartik 2083')
    fireEvent.click(await screen.findByRole('button', { name: 'Review Rs. 5,460 payment' }))
    server.fees.paidElsewhere(LATE_FINE)
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm and print' }))

    expect(await screen.findByText('The payment was not saved.')).toBeTruthy()
    expect(
      screen.getByText('Late fine, Ashwin 2083 has already been paid, perhaps at the other counter. Refresh the dues and try again.'),
    ).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole('checkbox', { name: 'Pay Late fine, Ashwin 2083' })).toBeNull())
    expect(sentTo(bridge.sent, new RegExp(`^/students/${BIBEK.id}/dues$`))).toHaveLength(2)
    // What was ticked and still owed stays ticked, and the receipt follows the dues as they are.
    expect(screen.getByRole('checkbox', { name: 'Pay Monthly tuition, Ashwin 2083' }).getAttribute('aria-checked')).toBe('true')
    expect(await screen.findByRole('button', { name: 'Review Rs. 5,360 payment' })).toBeTruthy()
    expect(server.fees.saved.size).toBe(0)
    // The paid fine is never asked about again: the dues were read before the next receipt.
    const afterRefusal = bridge.sent.slice(bridge.sent.findIndex((request) => request.path === '/payments'))
    const previews = sentTo(afterRefusal, /^\/payments\/preview$/).map((request) => request.body ?? '')
    expect(previews).toHaveLength(1)
    expect(previews[0]).not.toContain(LATE_FINE)
  })

  it('shows any other refusal in plain English and gives the form back', async () => {
    const { server } = await atTheCounter()
    await chooseBibek()
    tick('Monthly tuition, Kartik 2083')
    fireEvent.click(screen.getByRole('radio', { name: 'eSewa' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'eSewa transaction code' }), { target: { value: 'ES-77120' } })
    const message = errorMessage('ACCOUNT_NOT_SET_UP', { kind: 'bank', several: false })
    server.fees.refuseNext = json(422, { error: { code: 'ACCOUNT_NOT_SET_UP', message, details: {} } })
    await reviewAndConfirm('Rs. 3,680')

    expect(await screen.findByText(message)).toBeTruthy()
    expect((await screen.findByRole('button', { name: 'Review Rs. 3,680 payment' })).hasAttribute('disabled')).toBe(false)
    expect(screen.getByRole('checkbox', { name: 'Pay Monthly tuition, Kartik 2083' }).closest('[inert]')).toBeNull()
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'eSewa transaction code' }).value).toBe('ES-77120')
  })

  it('needs the reference for a payment that is not cash, and sends it with the method', async () => {
    const { bridge } = await atTheCounter()
    await chooseBibek()
    tick('Monthly tuition, Kartik 2083')
    expect(screen.getAllByRole('radio').map((method) => method.textContent)).toEqual([
      'Cash',
      'Fonepay QR',
      'Bank deposit',
      'eSewa',
      'Khalti',
      'Cheque',
    ])
    fireEvent.click(screen.getByRole('radio', { name: 'Cheque' }))
    expect(screen.getByRole('textbox', { name: 'Cheque number' })).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: 'Fonepay QR' }))
    const reference = screen.getByRole('textbox', { name: 'Fonepay transaction ID' })
    expect(screen.getByText('Required for non-cash payments.')).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: 'Cash received' })).toBeNull()
    expect((await screen.findByRole('button', { name: 'Review Rs. 3,680 payment' })).hasAttribute('disabled')).toBe(true)

    fireEvent.change(reference, { target: { value: ' FP-2083-55 ' } })
    expect(screen.getByText('Paid by Fonepay QR, reference FP-2083-55')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Review Rs. 3,680 payment' }))
    expect(screen.getByRole('heading', { name: 'Collect Rs. 3,680 by Fonepay QR?' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and print' }))
    await screen.findByText('Payment saved. Receipt 2083/84-001285 sent to the printer.')

    const [payment] = paymentsSent(bridge.sent)
    expect(payment?.method).toBe('fonepay')
    expect(payment?.reference).toBe('FP-2083-55')
  })

  it('asks for the original again with the same print key when its answer was lost, and prints it once', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { server, bridge } = await atTheCounter()
    await chooseBibek()
    tick('Late fine, Ashwin 2083')
    server.fees.loseNextPrintReply = true
    await reviewAndConfirm('Rs. 100')

    expect(await screen.findByText('Payment saved as receipt 2083/84-001285.')).toBeTruthy()
    expect(screen.getByText('It prints by itself when Computer 1 answers.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Next student' }).hasAttribute('disabled')).toBe(true)
    expect(bridge.printPdf).not.toHaveBeenCalled()

    await waitForChecks(1)
    expect(await screen.findByText('Payment saved. Receipt 2083/84-001285 sent to the printer.')).toBeTruthy()
    const asked = sentTo(bridge.sent, /^\/payments\/[0-9a-f-]+\/print$/).map((request) => request.body)
    expect(asked).toHaveLength(2)
    expect(asked[1]).toBe(asked[0])
    expect(server.fees.prints.size).toBe(1)
    expect(bridge.printPdf).toHaveBeenCalledTimes(1)
  })

  it('says to ask the Super Admin when the printer fails, and never asks for a second original', async () => {
    const { bridge } = await atTheCounter()
    bridge.printPdf.mockResolvedValueOnce({ printed: false, reason: 'The printer is offline.' })
    await chooseBibek()
    tick('Late fine, Ashwin 2083')
    await reviewAndConfirm('Rs. 100')

    expect(await screen.findByText('Payment saved as receipt 2083/84-001285.')).toBeTruthy()
    expect(screen.getByText('Printing failed. Ask the Super Admin to allow one more original.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Next student' }).hasAttribute('disabled')).toBe(false)
    expect(screen.queryByRole('button', { name: /Print/ })).toBeNull()
    expect(sentTo(bridge.sent, /^\/payments\/[0-9a-f-]+\/print$/)).toHaveLength(1)
  })

  it('shows the saved receipt from what Computer 1 saved, without asking for its PDF again', async () => {
    const { bridge } = await atTheCounter()
    await chooseBibek()
    tick('Monthly tuition, Ashwin 2083')
    tick('Late fine, Ashwin 2083')
    tick('Monthly tuition, Kartik 2083')
    await reviewAndConfirm('Rs. 5,460')
    await screen.findByText('Payment saved. Receipt 2083/84-001285 sent to the printer.')
    expect(within(screen.getByRole('region', { name: 'Receipt preview' })).getByText('No. 2083/84-001285')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'View receipt' }))
    const receipt = within(await screen.findByRole('dialog', { name: 'Receipt 2083/84-001285' }))
    expect(receipt.getByText('Student ID').textContent).toBe('Student ID MEMS-2076-0098')
    expect(receipt.getByText('Guardian').textContent).toBe('Guardian Pasang Lama')
    expect(receipt.getByText('For the months of').textContent).toBe('For the months of Ashwin and Kartik 2083')
    expect(receipt.getByText('Monthly tuition, Ashwin 2083 (balance)').parentElement?.textContent).toBe(
      '1Monthly tuition, Ashwin 2083 (balance)1,680.00',
    )
    expect(rowText('Amount paid')).toBe('Amount paid5,460.00')
    expect(receipt.getByText('In words:').textContent).toBe('In words: Rupees Five Thousand Four Hundred Sixty Only')
    expect(receipt.getByText('Paid by Cash. Received with thanks.')).toBeTruthy()
    expect(sentTo(bridge.sent, /^\/payments\/[0-9a-f-]+\/(print|reprint)$/)).toHaveLength(1)
  })

  it('says when a student owes nothing, and offers nothing to review', async () => {
    const { server } = await atTheCounter()
    for (const due of BIBEK_DUES) {
      server.fees.paidElsewhere(due.kind === 'fee' ? due.feeDueId : due.fineId)
    }
    fireEvent.keyDown(window, { key: 'F2' })
    const search = await screen.findByRole('combobox', { name: 'Find student' })
    fireEvent.focus(search)
    fireEvent.change(search, { target: { value: 'bibek' } })
    await screen.findByRole('option', { name: /Bibek Lama/ })
    fireEvent.keyDown(search, { key: 'Enter' })

    expect(await screen.findByText('Bibek Lama owes nothing.')).toBeTruthy()
    expect(screen.getByText('There is no fee to collect. Find another student.')).toBeTruthy()
    expect(screen.getByText('Nothing to collect from this student.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Review/ })).toBeNull()
    expect(screen.queryByRole('radiogroup', { name: 'Payment method' })).toBeNull()
  })

  it('opens from a dues row on the dashboard with that student', async () => {
    const { bridge } = await atTheCounter()
    fireEvent.click(screen.getByRole('button', { name: /^Bibek Lama/ }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Collect fee' })).toBeTruthy()
    expect(await screen.findByText('MEMS-2076-0098, Class 7 A, roll 17. Guardian Pasang Lama, 98600 12884')).toBeTruthy()
    expect(await screen.findByRole('checkbox', { name: 'Pay Monthly tuition, Kartik 2083' })).toBeTruthy()
    expect(sentTo(bridge.sent, new RegExp(`^/students/${BIBEK.id}/(dues|fees)$`)).map((request) => request.path).sort()).toEqual([
      `/students/${BIBEK.id}/dues`,
      `/students/${BIBEK.id}/fees`,
    ])
  })
})
