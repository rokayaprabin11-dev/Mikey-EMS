import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'

import { newQueryClient } from '../api/query.ts'
import { App } from '../App.tsx'
import { PASSWORD } from './fake-bridge.ts'

// The app window as Computer 2 shows it after sign-in as bikash.acc, against the fake bridge the
// test has set up (fakeBridge with computer1WithSignIn).
export async function showSignedIn(): Promise<void> {
  render(
    <QueryClientProvider client={newQueryClient()}>
      <App startAt="sign-in" />
    </QueryClientProvider>,
  )
  fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'bikash.acc' } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: PASSWORD } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
  await screen.findByText('31 receipts, 26 by you')
}

// Opens an item of the account menu in the top bar, by keyboard.
export async function openAccountMenu(item: string): Promise<void> {
  fireEvent.keyDown(screen.getByRole('button', { name: /account menu$/ }), { key: 'Enter' })
  fireEvent.keyDown(await screen.findByRole('menuitem', { name: item }), { key: 'Enter' })
}
