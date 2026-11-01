import { useState } from 'react'

import type { StartAt } from '../electron/bridge.ts'
import { en } from './i18n/en.ts'
import { Setup } from './setup/Setup.tsx'

// The app window, from where the splash handed over.
export function App({ startAt }: { startAt: StartAt }) {
  const [signIn, setSignIn] = useState(startAt === 'sign-in')

  if (!signIn) {
    return <Setup startAt={startAt === 'get-allowed' ? 'get-allowed' : 'setup'} onDone={() => setSignIn(true)} />
  }
  return (
    <main className="flex min-h-screen items-center justify-center p-7">
      <p className="text-ink-soft">{en.signIn.notBuilt}</p>
    </main>
  )
}
