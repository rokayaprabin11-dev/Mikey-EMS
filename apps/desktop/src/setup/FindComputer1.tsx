import { useMutation } from '@tanstack/react-query'
import { CircleAlert, CircleCheck } from 'lucide-react'
import { type FormEvent, useId, useState } from 'react'

import { addressOf, serverUrlFrom } from '../../electron/server-address.ts'
import { api } from '../api/client.ts'
import { bridge } from '../bridge.ts'
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert.tsx'
import { Button } from '../components/ui/button.tsx'
import { Input } from '../components/ui/input.tsx'
import { Label } from '../components/ui/label.tsx'
import { databaseDownProblem, type Problem, problemOf } from '../connection.ts'
import { en } from '../i18n/en.ts'
import type { ServerInfo } from './Setup.tsx'
import { StepNav } from './StepNav.tsx'

const words = en.setup.find

// Step 2. The address is tested with GET /health and saved only once Computer 1 has answered
// with its database working.
export function FindComputer1({
  savedUrl,
  onBack,
  onConnected,
}: {
  savedUrl: string | null
  onBack: () => void
  onConnected: (server: ServerInfo) => void
}) {
  const [typed, setTyped] = useState(savedUrl === null ? '' : addressOf(savedUrl))
  const [notAnAddress, setNotAnAddress] = useState(false)
  const [saving, setSaving] = useState(false)
  const test = useMutation({ mutationFn: (serverUrl: string) => api.testServer(serverUrl) })
  const errorId = useId()

  function onTest(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const serverUrl = serverUrlFrom(typed)
    setNotAnAddress(serverUrl === null)
    if (serverUrl === null) {
      test.reset()
      return
    }
    test.mutate(serverUrl)
  }

  const testedUrl = test.variables ?? null
  const health = test.data ?? null
  const connected = health?.db === 'ok' ? health : null
  let problem: Problem | null = null
  if (test.isError && testedUrl !== null) {
    problem = problemOf(test.error, addressOf(testedUrl))
  } else if (health?.db === 'down') {
    problem = databaseDownProblem(health)
  }

  function onContinue(): void {
    if (connected === null || testedUrl === null) {
      return
    }
    setSaving(true)
    void bridge()
      .setServerUrl(testedUrl)
      .then(() => onConnected({ serverName: connected.serverName, schoolName: connected.schoolName }))
  }

  return (
    <>
      <section className="flex flex-col gap-5">
        <h1 className="font-display text-[34px] font-semibold">{words.title}</h1>
        <p className="text-[15px] leading-relaxed text-ink-soft">{words.intro}</p>
        <form onSubmit={onTest} className="flex flex-wrap items-end gap-2.5">
          <Label className="min-w-55 flex-1">
            {words.address}
            <Input
              value={typed}
              onChange={(event) => {
                setTyped(event.target.value)
                setNotAnAddress(false)
                test.reset()
              }}
              placeholder={words.placeholder}
              aria-invalid={notAnAddress}
              aria-describedby={notAnAddress ? errorId : undefined}
              autoFocus
              className="h-11 text-base font-normal"
            />
          </Label>
          <Button type="submit" variant="secondary" size="lg" className="border-ink" disabled={test.isPending}>
            {test.isPending ? words.testing : words.test}
          </Button>
        </form>
        {notAnAddress && (
          <p id={errorId} className="-mt-3 text-[13px] text-bad">
            {words.notAnAddress}
          </p>
        )}
        {connected !== null && (
          <Alert variant="ok">
            <CircleCheck aria-hidden="true" />
            <AlertTitle>{words.connected(connected.serverName, connected.schoolName)}</AlertTitle>
          </Alert>
        )}
        {problem !== null && (
          <Alert variant="bad">
            <CircleAlert aria-hidden="true" />
            <div>
              <AlertTitle>{problem.title}</AlertTitle>
              {problem.help !== null && <AlertDescription>{problem.help}</AlertDescription>}
            </div>
          </Alert>
        )}
        <p className="text-[13px] text-ink-muted">{words.notFound}</p>
      </section>
      <StepNav onBack={onBack} canContinue={connected !== null && !saving} onContinue={onContinue} />
    </>
  )
}
