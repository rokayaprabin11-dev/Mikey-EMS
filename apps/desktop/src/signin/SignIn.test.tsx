// @vitest-environment happy-dom
import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { newQueryClient } from '../api/query.ts'
import { App } from '../App.tsx'
import { computer1WithSignIn, fakeBridge, PASSWORD, TOKEN } from '../testing/fake-bridge.ts'

afterEach(cleanup)

const SERVER = 'http://192.168.1.10:3100'

function showSignIn() {
  render(
    <QueryClientProvider client={newQueryClient()}>
      <App startAt="sign-in" />
    </QueryClientProvider>,
  )
}

function fill(username: string, password: string) {
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: username } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
}

describe('signing in on Computer 2', () => {
  it("shows Computer 1's answer and today, signs in, and signs out", async () => {
    const server = computer1WithSignIn()
    const bridge = fakeBridge({ serverUrl: SERVER, answer: server.answer })
    showSignIn()

    expect(await screen.findByText('Computer 1 found on the office network')).toBeTruthy()
    expect(screen.getByText(/^Server 192\.168\.1\.10, answered in \d+ ms$/)).toBeTruthy()
    expect(screen.getByText('Thursday, 12 Kartik 2083 (29 Oct 2026)')).toBeTruthy()
    expect(screen.getByText('Mikey English Medium School')).toBeTruthy()

    fill('bikash.acc', PASSWORD)
    expect(await screen.findByRole('heading', { name: 'Good morning, Bikash' })).toBeTruthy()
    const login = bridge.sent.find((request) => request.path === '/auth/login')
    expect(login?.token).toBeNull()
    expect(JSON.parse(login?.body ?? '')).toEqual({ username: 'bikash.acc', password: PASSWORD })

    // Sign out from the account menu in the top bar.
    fireEvent.keyDown(screen.getByRole('button', { name: 'Bikash Thapa, account menu' }), { key: 'Enter' })
    fireEvent.keyDown(await screen.findByRole('menuitem', { name: 'Sign out' }), { key: 'Enter' })
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeTruthy()
    expect(bridge.sent.find((request) => request.path === '/auth/logout')?.token).toBe(TOKEN)
    // Signed out: nothing from the session is shown, and no warning waits.
    expect(screen.queryByText(/You were signed out/)).toBeNull()
  })

  it('asks for both fields before sending anything', async () => {
    const bridge = fakeBridge({ serverUrl: SERVER, answer: computer1WithSignIn().answer })
    showSignIn()
    await screen.findByRole('heading', { name: 'Sign in' })
    fill('', '')
    expect(await screen.findByText('Type your username.')).toBeTruthy()
    expect(screen.getByText('Type your password.')).toBeTruthy()
    expect(screen.getByLabelText('Username').getAttribute('aria-invalid')).toBe('true')
    expect(bridge.sent.some((request) => request.path === '/auth/login')).toBe(false)
  })

  it("shows Computer 1's answer to a wrong password, and empties the password", async () => {
    fakeBridge({ serverUrl: SERVER, answer: computer1WithSignIn().answer })
    showSignIn()
    await screen.findByRole('heading', { name: 'Sign in' })
    fill('bikash.acc', 'not-it')
    expect(await screen.findByText('The username or password is not right. Check both and try again.')).toBeTruthy()
    expect(screen.getByLabelText<HTMLInputElement>('Password').value).toBe('')
    expect(screen.getByLabelText<HTMLInputElement>('Username').value).toBe('bikash.acc')
  })

  it("says when Computer 1 can't be reached, beside the form and in the status", async () => {
    const server = computer1WithSignIn()
    server.state.reachable = false
    fakeBridge({ serverUrl: SERVER, answer: server.answer })
    showSignIn()
    await screen.findByRole('heading', { name: 'Sign in' })
    await waitFor(() => expect(screen.getAllByText("Can't reach Computer 1 at 192.168.1.10.")).toHaveLength(1))
    fill('bikash.acc', PASSWORD)
    await waitFor(() => expect(screen.getAllByText("Can't reach Computer 1 at 192.168.1.10.")).toHaveLength(2))
  })

  it('opens setup from "Change server address"', async () => {
    fakeBridge({ serverUrl: SERVER, answer: computer1WithSignIn().answer })
    showSignIn()
    fireEvent.click(await screen.findByRole('button', { name: 'Change server address' }))
    expect(await screen.findByText('Which computer is this?')).toBeTruthy()
  })
})
