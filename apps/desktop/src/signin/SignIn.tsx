import { formatBsWithAd, kathmanduDate } from '@mikey/shared'
import { useMutation, useQuery } from '@tanstack/react-query'
import { CircleAlert, Clock } from 'lucide-react'
import { type FormEvent, useId, useRef, useState } from 'react'

import { addressOf } from '../../electron/server-address.ts'
import { ApiError } from '../api/client.ts'
import { bridge } from '../bridge.ts'
import { Crest } from '../components/Crest.tsx'
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert.tsx'
import { Button } from '../components/ui/button.tsx'
import { Input } from '../components/ui/input.tsx'
import { Label } from '../components/ui/label.tsx'
import { databaseDownProblem, type Problem, problemOf } from '../connection.ts'
import { type HealthCheck, useHealth } from '../health.ts'
import { en } from '../i18n/en.ts'
import { useSession } from '../session/session.tsx'

const words = en.signIn

// Today on Computer 1's clock, which dates every record: "Thursday, 12 Kartik 2083 (29 Oct 2026)".
function today(time: string): string {
  const ad = kathmanduDate(new Date(time))
  const weekday = en.weekdays[new Date(`${ad}T00:00:00Z`).getUTCDay()] ?? ''
  return words.today(weekday, formatBsWithAd(ad))
}

function healthProblem(health: ReturnType<typeof useHealth>, address: string): Problem | null {
  if (health.isError) {
    return problemOf(health.error, address)
  }
  return health.data?.health.db === 'down' ? databaseDownProblem(health.data.health) : null
}

function ConnectionStatus({ check, problem, address }: { check: HealthCheck | undefined; problem: Problem | null; address: string }) {
  let title: string = words.checking
  let detail: string | null = null
  if (problem !== null) {
    title = problem.title
    detail = problem.help
  } else if (check !== undefined) {
    title = words.found
    detail = words.answered(address, check.tookMs)
  }
  return (
    <div role="status" className="mt-auto flex max-w-115 flex-col gap-1.5 border-t border-chrome-accountant-active pt-5">
      <div className="flex items-center gap-2.5 text-[15px] font-semibold">
        {(problem !== null || check !== undefined) && (
          <span aria-hidden="true" className={`size-2.5 flex-none rounded-full ${problem === null ? 'bg-ok-tint' : 'bg-bad-tint'}`} />
        )}
        {title}
      </div>
      {detail !== null && <div className="text-[13px] text-surface/70">{detail}</div>}
    </div>
  )
}

// Sign-in on Computer 2, with whether Computer 1 is answering beside it.
export function SignIn({ onChangeServer }: { onChangeServer: () => void }) {
  const { signIn, notice } = useSession()
  const saved = useQuery({ queryKey: ['server-url'], queryFn: () => bridge().getServerUrl() })
  const health = useHealth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [missing, setMissing] = useState({ username: false, password: false })
  const passwordField = useRef<HTMLInputElement>(null)
  const usernameError = useId()
  const passwordError = useId()
  const submit = useMutation({
    mutationFn: () => signIn(username, password),
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'WRONG_USERNAME_OR_PASSWORD') {
        setPassword('')
        passwordField.current?.focus()
      }
    },
  })

  if (!saved.isSuccess) {
    return null
  }
  if (saved.data === null) {
    throw new Error('Sign-in opened before a server address was saved.')
  }
  const address = addressOf(saved.data)
  const check = health.data
  const school = check?.health.db === 'ok' ? check.health.schoolName : null
  const problem = submit.isError ? problemOf(submit.error, address) : null

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const nowMissing = { username: username.trim() === '', password: password === '' }
    setMissing(nowMissing)
    if (!nowMissing.username && !nowMissing.password) {
      submit.mutate()
    }
  }

  return (
    <div className="flex min-h-screen flex-wrap bg-paper text-ink">
      <section className="flex min-h-90 flex-[1_1_420px] flex-col gap-10 bg-chrome-accountant px-14 pt-14 pb-10 text-surface">
        <div className="flex items-center gap-4.5">
          <Crest width={64} />
          <span className="max-w-60 font-display text-[30px] leading-[1.05] font-semibold">{school ?? en.appName}</span>
        </div>
        <div className="flex max-w-115 flex-col gap-2.5">
          <h1 className="font-display text-[44px] leading-[1.05] font-semibold">{words.counter}</h1>
          <p className="text-[15px] leading-[1.55] text-surface/85">{words.intro}</p>
        </div>
        <ConnectionStatus check={check} problem={healthProblem(health, address)} address={address} />
      </section>

      <section className="flex flex-[1_1_420px] items-center justify-center px-6 py-12">
        <form noValidate onSubmit={onSubmit} className="flex w-full max-w-95 flex-col gap-4.5">
          <div className="flex flex-col gap-1.5">
            {check !== undefined && <p className="text-[13px] text-ink-muted">{today(check.health.time)}</p>}
            <h2 className="font-display text-[32px] font-semibold">{words.title}</h2>
          </div>
          {notice !== null && (
            <Alert variant="warn">
              <Clock aria-hidden="true" />
              <AlertTitle>{notice}</AlertTitle>
            </Alert>
          )}
          <div className="flex flex-col gap-1.5">
            <Label className="text-[13.5px]">
              {words.username}
              <Input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                autoFocus
                aria-invalid={missing.username}
                aria-describedby={missing.username ? usernameError : undefined}
                className="h-11 text-[15px] font-normal"
              />
            </Label>
            {missing.username && (
              <p id={usernameError} className="text-[13px] text-bad">
                {words.typeUsername}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-[13.5px]">
              {words.password}
              <Input
                ref={passwordField}
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                aria-invalid={missing.password}
                aria-describedby={missing.password ? passwordError : undefined}
                className="h-11 text-[15px] font-normal"
              />
            </Label>
            {missing.password && (
              <p id={passwordError} className="text-[13px] text-bad">
                {words.typePassword}
              </p>
            )}
          </div>
          {problem !== null && (
            <Alert variant="bad">
              <CircleAlert aria-hidden="true" />
              <div>
                <AlertTitle>{problem.title}</AlertTitle>
                {problem.help !== null && <AlertDescription>{problem.help}</AlertDescription>}
              </div>
            </Alert>
          )}
          <Button type="submit" className="h-11.5 text-[15px]" disabled={submit.isPending}>
            {submit.isPending ? words.signingIn : words.submit}
          </Button>
          <div className="flex flex-col items-start gap-1.5 rounded-lg border border-line bg-surface p-3.5 text-[13px] leading-normal text-ink-muted">
            <span>{words.forgot}</span>
            <button
              type="button"
              onClick={onChangeServer}
              className="cursor-pointer font-semibold text-action outline-none hover:text-action-hover hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
            >
              {words.changeServer}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}
