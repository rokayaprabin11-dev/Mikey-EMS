// @vitest-environment happy-dom
import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { newQueryClient } from '../api/query.ts'
import { fakeBridge, health, json, NO_REPLY } from '../testing/fake-bridge.ts'
import { Splash } from './Splash.tsx'

afterEach(cleanup)

const SERVER = 'http://192.168.1.10:3100'

function showSplash() {
  render(
    <QueryClientProvider client={newQueryClient()}>
      <Splash />
    </QueryClientProvider>,
  )
}

describe('the splash', () => {
  it('opens setup when no server address is saved yet', async () => {
    const bridge = fakeBridge({ serverUrl: null })
    showSplash()
    await waitFor(() => expect(bridge.finishStartup).toHaveBeenCalledWith('setup'))
    expect(bridge.sent).toEqual([])
  })

  it('opens sign-in when Computer 1 answers and allows this computer', async () => {
    const bridge = fakeBridge({ serverUrl: SERVER, answer: () => health() })
    showSplash()
    expect(await screen.findByText('Connecting to Computer 1 at 192.168.1.10')).toBeTruthy()
    await waitFor(() => expect(bridge.finishStartup).toHaveBeenCalledWith('sign-in'))
    expect(bridge.sent.map((request) => request.path)).toEqual(['/health'])
  })

  it('opens "Get allowed" when Computer 1 answers but no longer allows this computer', async () => {
    const bridge = fakeBridge({ serverUrl: SERVER, answer: () => health({ allowed: false }) })
    showSplash()
    await waitFor(() => expect(bridge.finishStartup).toHaveBeenCalledWith('get-allowed'))
  })

  it("says when Computer 1 can't be reached, and can try again or change the address", async () => {
    const bridge = fakeBridge({ serverUrl: SERVER, answer: () => NO_REPLY })
    showSplash()
    expect(await screen.findByText("Can't reach Computer 1 at 192.168.1.10.")).toBeTruthy()
    expect(screen.getByText('Check that Computer 1 is on and that both network cables are plugged in.')).toBeTruthy()
    expect(screen.getByText('Version 0.1.0')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(bridge.sent).toHaveLength(2))
    expect(await screen.findByText("Can't reach Computer 1 at 192.168.1.10.")).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Change the server address' }))
    expect(bridge.finishStartup).toHaveBeenCalledWith('setup')
  })

  it('says when Computer 1 is on but its database has stopped, and opens nothing', async () => {
    const bridge = fakeBridge({
      serverUrl: SERVER,
      answer: () => json(200, { server: 'ok', db: 'down', time: '2026-11-01T04:19:00.000Z', serverName: 'MIKEY-SERVER' }),
    })
    showSplash()
    expect(await screen.findByText('Computer 1 is on, but its database has stopped.')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('Ask the Super Admin to restart Computer 1.')
    expect(bridge.finishStartup).not.toHaveBeenCalled()
  })
})
