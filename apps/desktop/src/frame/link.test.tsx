// @vitest-environment happy-dom
import { QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { newQueryClient } from '../api/query.ts'
import { App } from '../App.tsx'
import { computer1WithSignIn, fakeBridge, PASSWORD } from '../testing/fake-bridge.ts'

// /health is asked every 5 seconds (ARCHITECTURE.md, Health and connection status).
const CHECK = 5_000

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

async function signedIn() {
  const server = computer1WithSignIn()
  fakeBridge({ serverUrl: 'http://192.168.1.10:3100', answer: server.answer })
  render(
    <QueryClientProvider client={newQueryClient()}>
      <App startAt="sign-in" />
    </QueryClientProvider>,
  )
  fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'bikash.acc' } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: PASSWORD } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
  await screen.findByText('31 receipts, 26 by you')
  return server
}

async function checks(count: number): Promise<void> {
  for (let check = 0; check < count; check += 1) {
    await act(() => vi.advanceTimersByTimeAsync(CHECK))
  }
}

function pill(): string {
  return screen.getAllByRole('status').map((status) => status.textContent).join(' | ')
}

describe('losing Computer 1 while signed in', () => {
  it('says "Reconnecting" after two missed checks, blocks the app after 15 seconds, and comes back by itself', async () => {
    const server = await signedIn()
    expect(pill()).toContain('Connected to server')
    expect(screen.getByText('Connected to Computer 1')).toBeTruthy()

    server.state.reachable = false
    await checks(1)
    expect(pill()).toContain('Connected to server')
    await checks(1)
    expect(pill()).toContain('Reconnecting…')
    expect(screen.getByText('Reconnecting to Computer 1')).toBeTruthy()
    expect(screen.queryByRole('alertdialog')).toBeNull()

    await checks(2)
    const blocked = await screen.findByRole('alertdialog', { name: "Can't reach Computer 1" })
    expect(blocked.textContent).toMatch(/Server unavailable since \d{1,2}:\d{2} [AP]M/)
    expect(blocked.textContent).toContain('Trying again by itself every 5 seconds. Attempt 4.')
    expect(blocked.textContent).toContain('Computer 1 in the office is switched on and not asleep.')
    expect(blocked.textContent).toContain('Internet is not needed. Only the office network between the two computers.')

    server.state.reachable = true
    fireEvent.click(screen.getByRole('button', { name: 'Try again now' }))
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(pill()).toContain('Connected to server')
    // The screen underneath is as it was.
    expect(screen.getByText('31 receipts, 26 by you')).toBeTruthy()
  })

  it('treats a stopped database like no answer, and says so', async () => {
    const server = await signedIn()
    server.state.databaseDown = true
    await checks(4)
    const blocked = await screen.findByRole('alertdialog', { name: 'Computer 1 is on, but its database has stopped.' })
    expect(blocked.textContent).toContain('Nothing has been lost. Ask the Super Admin to restart Computer 1.')
    expect(blocked.textContent).not.toContain('Check these')
  })
})
