// @vitest-environment happy-dom
import { QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { newQueryClient } from '../api/query.ts'
import { App } from '../App.tsx'
import { computer1WithSignIn, type FakeBridge, fakeBridge, PASSWORD } from '../testing/fake-bridge.ts'

const MINUTE = 60_000
const SIGNED_OUT_IDLE = 'You were signed out because the app was not used for 15 minutes. Sign in again.'

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

async function signedIn(): Promise<{ bridge: FakeBridge; server: ReturnType<typeof computer1WithSignIn> }> {
  const server = computer1WithSignIn()
  const bridge = fakeBridge({ serverUrl: 'http://192.168.1.10:3100', answer: server.answer })
  render(
    <QueryClientProvider client={newQueryClient()}>
      <App startAt="sign-in" />
    </QueryClientProvider>,
  )
  fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'bikash.acc' } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: PASSWORD } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
  await screen.findByRole('heading', { name: 'Good morning, Bikash' })
  return { bridge, server }
}

// Time passing with nobody at the computer: the clock jumps on, then the app's one-second checks
// run once. (Running every second of 14 minutes inside one act() is far more updates than any
// real idle stretch makes, and React stops it as a loop.)
async function wait(ms: number): Promise<void> {
  vi.setSystemTime(Date.now() + ms)
  await act(() => vi.advanceTimersByTimeAsync(1_000))
}

function sessionChecks(bridge: FakeBridge): number {
  return bridge.sent.filter((request) => request.path === '/auth/session').length
}

describe('signing out an idle session', () => {
  it('warns in the last minute, and "Stay signed in" starts the time again', async () => {
    const { bridge } = await signedIn()
    await wait(13 * MINUTE)
    expect(screen.queryByRole('alertdialog')).toBeNull()

    await wait(MINUTE)
    expect(await screen.findByRole('alertdialog')).toBeTruthy()
    expect(screen.getByText(/^Signing you out in [01]:\d\d$/)).toBeTruthy()
    expect(screen.getByText('No activity for 14 minutes. Anything already saved is safe.')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Stay signed in' }))
    await wait(1_000)
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(sessionChecks(bridge)).toBe(1)

    // A full idle time from the click, not from sign-in.
    await wait(13 * MINUTE)
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Good morning, Bikash' })).toBeTruthy()
  })

  it("signs out at the end with Computer 1's own words, after asking it once more", async () => {
    const { bridge, server } = await signedIn()
    await wait(14 * MINUTE + 30_000)
    expect(await screen.findByRole('alertdialog')).toBeTruthy()

    // Computer 1 has ended the session by then.
    server.state.ended = true
    await wait(31_000)
    expect(await screen.findByText(SIGNED_OUT_IDLE)).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeTruthy()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(sessionChecks(bridge)).toBe(1)
  })

  it('signs out by itself at the end when Computer 1 cannot be reached', async () => {
    const { server } = await signedIn()
    server.state.reachable = false
    await wait(15 * MINUTE + 1_000)
    expect(await screen.findByText(SIGNED_OUT_IDLE)).toBeTruthy()
  })

  it('counts keys, clicks and scrolling as activity, telling Computer 1 at most once a minute', async () => {
    const { bridge } = await signedIn()
    await wait(30_000)
    fireEvent.keyDown(window, { key: 'a' })
    expect(sessionChecks(bridge)).toBe(0)

    await wait(MINUTE)
    fireEvent.keyDown(window, { key: 'a' })
    fireEvent.pointerDown(window)
    fireEvent.wheel(window)
    await wait(0)
    expect(sessionChecks(bridge)).toBe(1)

    // Kept busy for 20 minutes: never warned.
    for (let minute = 0; minute < 20; minute += 1) {
      await wait(MINUTE)
      fireEvent.pointerDown(window)
    }
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Good morning, Bikash' })).toBeTruthy()
  })

  it('goes back to sign-in whenever Computer 1 says the session has ended', async () => {
    const { server } = await signedIn()
    server.state.ended = true
    // Any signed-in request finds out; here the activity check makes one.
    await wait(MINUTE)
    fireEvent.keyDown(window, { key: 'a' })
    expect(await screen.findByText(SIGNED_OUT_IDLE)).toBeTruthy()
  })
})
