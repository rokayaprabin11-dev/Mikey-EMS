import { useState } from 'react'

import type { StartAt } from '../electron/bridge.ts'
import { Frame } from './frame/Frame.tsx'
import { LinkProvider } from './frame/link.tsx'
import { SessionProvider, useSession } from './session/session.tsx'
import { Setup } from './setup/Setup.tsx'
import { SignIn } from './signin/SignIn.tsx'

function SignedInOrNot({ onChangeServer }: { onChangeServer: () => void }) {
  const { session } = useSession()
  if (session === null) {
    return <SignIn onChangeServer={onChangeServer} />
  }
  return (
    <LinkProvider>
      <Frame session={session} />
    </LinkProvider>
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
