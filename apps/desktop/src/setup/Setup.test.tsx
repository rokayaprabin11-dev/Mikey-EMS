// @vitest-environment happy-dom
import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ServerRequest } from '../../electron/bridge.ts'
import { newQueryClient } from '../api/query.ts'
import { fakeBridge, health, json, NO_REPLY } from '../testing/fake-bridge.ts'
import { Setup } from './Setup.tsx'

afterEach(cleanup)

const SERVER = 'http://192.168.1.10:3100'
// 10:04 AM in Kathmandu.
const DECIDED_AT = '2026-11-01T04:19:00.000Z'
const PRINTERS = [
  { name: 'EPSON_L3150', displayName: 'EPSON L3150 Series', description: 'Front office' },
  { name: 'Microsoft Print to PDF', displayName: 'Microsoft Print to PDF', description: '' },
]

function showSetup(startAt: 'setup' | 'get-allowed' = 'setup') {
  const onDone = vi.fn()
  render(
    <QueryClientProvider client={newQueryClient()}>
      <Setup startAt={startAt} onDone={onDone} />
    </QueryClientProvider>,
  )
  return onDone
}

function click(name: string) {
  fireEvent.click(screen.getByRole('button', { name }))
}

function buttonEnabled(name: string): boolean {
  return !screen.getByRole<HTMLButtonElement>('button', { name }).disabled
}

function type(text: string) {
  fireEvent.change(screen.getByLabelText('Server address'), { target: { value: text } })
}

// A Computer 1 that keeps this computer's request pending until `allow()` is called.
function computer1(options: { declined?: boolean } = {}) {
  let allowed = false
  let declined = options.declined ?? false
  const answer = (request: ServerRequest) => {
    if (request.path === '/health') {
      return health({ allowed })
    }
    if (request.path === '/connection-requests') {
      const body = JSON.parse(request.body ?? '{}') as { askAgain: boolean }
      if (body.askAgain) {
        declined = false
      }
      const status = allowed ? 'allowed' : declined ? 'declined' : 'pending'
      return json(200, { ip: '192.168.1.11', status, decidedAt: status === 'pending' ? null : DECIDED_AT })
    }
    throw new Error(`Not expected: ${request.path}`)
  }
  return {
    answer,
    allow: () => {
      allowed = true
    },
  }
}

describe('Computer 2 setup', () => {
  it('goes from "Which computer" to Ready, saving the address and the printer', async () => {
    const server = computer1()
    const bridge = fakeBridge({
      serverUrl: null,
      printers: PRINTERS,
      answer: server.answer,
      testAnswer: (url) => (url === SERVER ? health() : NO_REPLY),
    })
    const onDone = showSetup()

    // 1. Which computer: only Computer 2 can be chosen in this version.
    expect(await screen.findByText('Which computer is this?')).toBeTruthy()
    expect(screen.getByText('Step 1 of 4')).toBeTruthy()
    const [serverOption, counterOption] = screen.getAllByRole('radio')
    expect(serverOption?.hasAttribute('disabled')).toBe(true)
    expect(screen.getByText('Not available in this version yet.')).toBeTruthy()
    expect(counterOption?.getAttribute('aria-checked')).toBe('true')
    click('Continue')

    // 2. Find Computer 1: the address is checked, then tested, and saved on Continue.
    expect(await screen.findByRole('heading', { name: 'Find Computer 1' })).toBeTruthy()
    expect(buttonEnabled('Continue')).toBe(false)
    type('not an address')
    click('Test connection')
    expect(await screen.findByText('Type the address shown on Computer 1, for example 192.168.1.10.')).toBeTruthy()
    expect(screen.getByLabelText('Server address').getAttribute('aria-invalid')).toBe('true')
    expect(bridge.tested).toEqual([])

    type('192.168.1.99')
    click('Test connection')
    expect(await screen.findByText("Can't reach Computer 1 at 192.168.1.99.")).toBeTruthy()
    expect(buttonEnabled('Continue')).toBe(false)

    type('192.168.1.10')
    click('Test connection')
    expect(await screen.findByText('Connected to MIKEY-SERVER, Mikey English Medium School.')).toBeTruthy()
    expect(bridge.saved.serverUrl).toBeNull()
    click('Continue')

    // 3. Get allowed: the request names this computer, and Computer 1's reply gives its address.
    expect(await screen.findByText('Waiting for Computer 1 to allow this computer')).toBeTruthy()
    expect(bridge.saved.serverUrl).toBe(SERVER)
    expect(await screen.findByText('ACCOUNTS-PC, 192.168.1.11')).toBeTruthy()
    expect(JSON.parse(bridge.sent.find((request) => request.path === '/connection-requests')?.body ?? '')).toEqual({
      computerName: 'ACCOUNTS-PC',
      askAgain: false,
    })
    expect(buttonEnabled('Continue')).toBe(false)

    server.allow()
    click('Check again')
    expect(await screen.findByText('Allowed at 10:04 AM.')).toBeTruthy()
    expect(screen.getByText('This computer is allowed')).toBeTruthy()
    await waitFor(() => expect(buttonEnabled('Continue')).toBe(true))
    click('Continue')

    // 4. Receipt printer: nothing is chosen until the accountant picks one.
    expect(await screen.findByText('EPSON L3150 Series')).toBeTruthy()
    expect(screen.getByText('A5 sheet')).toBeTruthy()
    expect(buttonEnabled('Finish setup')).toBe(false)
    fireEvent.click(screen.getByRole('radio', { name: /EPSON L3150 Series/ }))
    await waitFor(() => expect(buttonEnabled('Finish setup')).toBe(true))
    click('Finish setup')

    // Ready.
    expect(await screen.findByText('This counter is ready')).toBeTruthy()
    expect(bridge.saved.printer).toEqual({ name: 'EPSON_L3150', paper: 'A5' })
    expect(screen.getByText('MIKEY-SERVER, 192.168.1.10')).toBeTruthy()
    expect(screen.getByText('EPSON L3150 Series, A5')).toBeTruthy()
    expect(screen.queryByText(/Step \d of 4/)).toBeNull()
    click('Go to sign in')
    expect(onDone).toHaveBeenCalledOnce()
  })

  it('asks when this computer was allowed as soon as /health says it is', async () => {
    // The Super Admin allows it between the request and the first health check.
    let requests = 0
    const bridge = fakeBridge({
      serverUrl: SERVER,
      answer: (request) => {
        if (request.path === '/health') {
          return health({ allowed: true })
        }
        requests += 1
        return json(200, { ip: '192.168.1.11', status: requests === 1 ? 'pending' : 'allowed', decidedAt: requests === 1 ? null : DECIDED_AT })
      },
    })
    showSetup('get-allowed')
    expect(await screen.findByText('Allowed at 10:04 AM.')).toBeTruthy()
    expect(bridge.sent.filter((request) => request.path === '/connection-requests')).toHaveLength(2)
  })

  it('starts at "Get allowed" for a computer Computer 1 no longer allows, with the first steps done', async () => {
    fakeBridge({ serverUrl: SERVER, answer: computer1().answer })
    showSetup('get-allowed')
    expect(await screen.findByText('Waiting for Computer 1 to allow this computer')).toBeTruthy()
    expect(screen.getByText('Step 3 of 4')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Get allowed/ }).getAttribute('aria-current')).toBe('step')

    // A done step can be opened again, with the saved address filled in.
    fireEvent.click(screen.getByRole('button', { name: /Find Computer 1/ }))
    expect((await screen.findByLabelText<HTMLInputElement>('Server address')).value).toBe('192.168.1.10')
    expect(screen.getByRole('button', { name: /Receipt printer/ }).hasAttribute('disabled')).toBe(true)
  })

  it('shows a declined request, and asks again only when the accountant says so', async () => {
    const bridge = fakeBridge({ serverUrl: SERVER, answer: computer1({ declined: true }).answer })
    showSetup('get-allowed')
    expect(await screen.findByText('Computer 1 declined this computer')).toBeTruthy()
    expect(screen.getByText('Declined at 10:04 AM.')).toBeTruthy()
    expect(buttonEnabled('Continue')).toBe(false)

    click('Ask again')
    expect(await screen.findByText('Waiting for Computer 1 to allow this computer')).toBeTruthy()
    const asked = bridge.sent
      .filter((request) => request.path === '/connection-requests')
      .map((request) => (JSON.parse(request.body ?? '{}') as { askAgain: boolean }).askAgain)
    expect(asked).toEqual([false, true])
  })

  it("does not go on while Computer 1's database has stopped", async () => {
    fakeBridge({
      serverUrl: null,
      testAnswer: () => json(200, { server: 'ok', db: 'down', time: DECIDED_AT, serverName: 'MIKEY-SERVER' }),
    })
    showSetup()
    expect(await screen.findByText('Which computer is this?')).toBeTruthy()
    click('Continue')
    type('192.168.1.10')
    click('Test connection')
    expect(await screen.findByText('Computer 1 is on, but its database has stopped.')).toBeTruthy()
    expect(buttonEnabled('Continue')).toBe(false)
  })

  it('can finish without a printer when Windows has none, and says each receipt opens the print window', async () => {
    const bridge = fakeBridge({ serverUrl: SERVER, printers: [], answer: computer1().answer })
    const server = computer1()
    server.allow()
    window.mikey = { ...bridge, request: (request) => Promise.resolve(server.answer(request)) }
    showSetup('get-allowed')
    expect(await screen.findByText('Allowed at 10:04 AM.')).toBeTruthy()
    await waitFor(() => expect(buttonEnabled('Continue')).toBe(true))
    click('Continue')
    expect(await screen.findByText('No printers are set up on this computer.')).toBeTruthy()
    await waitFor(() => expect(buttonEnabled('Finish setup')).toBe(true))
    click('Finish setup')
    expect(await screen.findByText('The Windows print window, each time')).toBeTruthy()
  })
})
