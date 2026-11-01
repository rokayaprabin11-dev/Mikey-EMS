import { useState } from 'react'

import type { StartAt } from '../electron/bridge.ts'
import { Button } from './components/ui/button.tsx'
import { en } from './i18n/en.ts'
import { SessionProvider, useSession } from './session/session.tsx'
import { Setup } from './setup/Setup.tsx'
import { SignIn } from './signin/SignIn.tsx'

function SignedInOrNot({ onChangeServer }: { onChangeServer: () => void }) {
  const { session, signOut } = useSession()
  if (session === null) {
    return <SignIn onChangeServer={onChangeServer} />
  }
  // Until the app frame is built (Phase 5f).
  return (
    <main className="flex min-h-screen items-center justify-center bg-paper p-7 text-ink">
      <div className="flex max-w-120 flex-col items-start gap-3 rounded-lg border border-line bg-surface px-6 py-5.5">
        <h1 className="font-display text-[26px] font-semibold">{en.signedIn.title(session.user.fullName)}</h1>
        <p className="text-ink-muted">{en.signedIn.role(en.roles[session.user.role])}</p>
        <p className="leading-normal text-ink-soft">{en.signedIn.next}</p>
        <Button variant="secondary" onClick={() => void signOut()}>
          {en.signedIn.signOut}
        </Button>
      </div>
    </main>
  )
}

// The app window, from where the splash handed over.
export function App({ startAt }: { startAt: StartAt }) {
  const [screen, setScreen] = useState<StartAt>(startAt)

  if (screen !== 'sign-in') {
    return <Setup key={screen} startAt={screen} onDone={() => setScreen('sign-in')} />
  }
  return (
    <SessionProvider>
      <SignedInOrNot onChangeServer={() => setScreen('setup')} />
    </SessionProvider>
  )
}
