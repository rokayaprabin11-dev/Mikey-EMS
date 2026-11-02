// @vitest-environment happy-dom
import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { newQueryClient } from '../api/query.ts'
import { App } from '../App.tsx'
import { computer1WithSignIn, type FakeBridge, fakeBridge, PASSWORD } from '../testing/fake-bridge.ts'

afterEach(cleanup)

async function signedIn(): Promise<FakeBridge> {
  const bridge = fakeBridge({ serverUrl: 'http://192.168.1.10:3100', answer: computer1WithSignIn().answer })
  render(
    <QueryClientProvider client={newQueryClient()}>
      <App startAt="sign-in" />
    </QueryClientProvider>,
  )
  fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'bikash.acc' } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: PASSWORD } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
  await screen.findByRole('heading', { name: 'Good morning, Bikash' })
  return bridge
}

describe("the Accountant's dashboard", () => {
  it("shows today's figures from Computer 1", async () => {
    await signedIn()
    expect(await screen.findByText('31 receipts, 26 by you')).toBeTruthy()
    expect(screen.getByText('Accounts counter, Computer 2')).toBeTruthy()
    expect(screen.getByText('Thursday, 12 Kartik 2083')).toBeTruthy()
    expect(screen.getByText('29 Oct 2026, 10:04 AM')).toBeTruthy()

    const totals = (label: string) => screen.getByText(label).closest('div')?.textContent
    expect(totals('Collected today')).toBe('Collected todayRs. 48,60031 receipts, 26 by you')
    expect(totals('Voids today')).toBe('Voids todayRs. 1,2001 receipt from earlier days')
    expect(totals('Collected in Kartik')).toBe('Collected in KartikRs. 6,84,250Up to 12 Kartik')
    expect(totals('Fees outstanding')).toBe('Fees outstandingRs. 18,42,900212 students')
    expect(totals('Spent today')).toBe('Spent todayRs. 7,4503 entries')
    expect(totals('Cash in hand')).toBe('Cash in handRs. 1,12,340Per cashbook')
    expect(totals('Bank balance')).toBe('Bank balanceRs. 14,86,775Current account')

    const receipts = within(screen.getByRole('table'))
    expect(receipts.getByText('Aarav Shrestha')).toBeTruthy()
    expect(receipts.getByText('2083/84-001284')).toBeTruthy()
    expect(receipts.getByText('Fonepay QR')).toBeTruthy()
    expect(receipts.getByText('10:52 AM')).toBeTruthy()
    expect(receipts.getByText('Void requested')).toBeTruthy()

    expect(screen.getByText('Kartik dates. Today so far: Rs. 48,600.')).toBeTruthy()
    expect(screen.getByText('Class 7 A, Ashwin 2083 balance, Kartik 2083 and a fine')).toBeTruthy()
    expect(screen.getByText('Utilities, bank')).toBeTruthy()
    expect(screen.getByText('Whiteboard markers and chalk').closest('li')?.textContent).toContain('Void requested')
    expect(screen.getByText(/count the cash drawer/).textContent).toContain('Expected now: Rs. 1,12,340.')
  })

  it('opens each screen from the sidebar, and says plainly which are not built yet', async () => {
    await signedIn()
    const menu = within(screen.getByRole('navigation', { name: 'Main menu' }))
    expect(menu.getByRole('button', { name: 'Dashboard' }).getAttribute('aria-current')).toBe('page')

    fireEvent.click(menu.getByRole('button', { name: 'Payments' }))
    expect(await screen.findByText('This screen is built in Phase 6b.')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1, name: 'Payments' })).toBeTruthy()
    expect(menu.getByRole('button', { name: 'Payments' }).getAttribute('aria-current')).toBe('page')

    fireEvent.click(menu.getByRole('button', { name: 'Dashboard' }))
    expect(await screen.findByText('31 receipts, 26 by you')).toBeTruthy()
  })

  it('opens Collect fee with F2 and the student search with Ctrl+K', async () => {
    await signedIn()
    fireEvent.keyDown(window, { key: 'F2' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Collect fee' })).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Find student' })))

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Search students' }))
  })

  it('finds students as you type, by name or by the last digits of a guardian phone', async () => {
    const bridge = await signedIn()
    const search = screen.getByRole('combobox', { name: 'Search students' })
    fireEvent.focus(search)
    fireEvent.change(search, { target: { value: '4567' } })
    const option = await screen.findByRole('option', { name: /Sita Gurung/ })
    expect(option.textContent).toContain('Class 4 B, roll 12, MEMS-2079-0123')
    expect(option.textContent).toContain('Hari Gurung, 9841234567')
    expect(option.textContent).toContain('Owes Rs. 3,600')
    expect(bridge.sent.some((request) => request.path === '/students?q=4567')).toBe(true)

    fireEvent.change(search, { target: { value: 'bibak' } })
    expect(await screen.findByText('No student matches “bibak”.')).toBeTruthy()
    expect(screen.getByText('Check the spelling, or search by student ID or guardian phone.')).toBeTruthy()

    // Choosing a student opens Collect fee with them.
    fireEvent.change(search, { target: { value: 'sita' } })
    await screen.findByRole('option', { name: /Sita Gurung/ })
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Collect fee' })).toBeTruthy()
    expect(screen.getByText('MEMS-2079-0123, Class 4 B, roll 12. Guardian Hari Gurung, 9841234567')).toBeTruthy()
    expect(await screen.findByRole('checkbox', { name: 'Pay Monthly tuition, Kartik 2083' })).toBeTruthy()
  })
})
