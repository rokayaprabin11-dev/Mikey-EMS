import { useQuery } from '@tanstack/react-query'
import { Check, LoaderCircle } from 'lucide-react'
import { useEffect } from 'react'

import type { StartAt } from '../../electron/bridge.ts'
import { addressOf } from '../../electron/server-address.ts'
import { api } from '../api/client.ts'
import { bridge } from '../bridge.ts'
import { CopyDetailsButton } from '../components/CopyDetailsButton.tsx'
import { Crest } from '../components/Crest.tsx'
import { Button } from '../components/ui/button.tsx'
import { databaseDownProblem, errorDetails, type Problem, problemOf } from '../connection.ts'
import { en } from '../i18n/en.ts'

const words = en.splash
const HEALTH_TIMEOUT_MS = 5_000

type Outcome = { startAt: StartAt } | { problem: Problem } | null

// The splash window (640 × 400): checks the saved server address, then hands over to the app
// window at setup, at "Get allowed" or at sign-in. When Computer 1 cannot be used it says why
// and stays open.
export function Splash() {
  const serverUrl = useQuery({ queryKey: ['server-url'], queryFn: () => bridge().getServerUrl(), staleTime: Infinity })
  const version = useQuery({ queryKey: ['app-version'], queryFn: () => bridge().appVersion(), staleTime: Infinity })
  const computerName = useQuery({
    queryKey: ['computer-name'],
    queryFn: () => bridge().computerName(),
    staleTime: Infinity,
  })
  const savedUrl = serverUrl.data ?? null
  const health = useQuery({
    queryKey: ['startup-health', savedUrl],
    queryFn: () => api.call('health', { timeoutMs: HEALTH_TIMEOUT_MS }),
    enabled: savedUrl !== null,
    staleTime: Infinity,
  })

  let outcome: Outcome = null
  if (serverUrl.isSuccess && savedUrl === null) {
    outcome = { startAt: 'setup' }
  } else if (health.isSuccess) {
    outcome =
      health.data.db === 'down'
        ? { problem: databaseDownProblem(health.data) }
        : { startAt: health.data.allowed ? 'sign-in' : 'get-allowed' }
  } else if (health.isError && savedUrl !== null) {
    outcome = { problem: problemOf(health.error, addressOf(savedUrl)) }
  }
  const startAt = outcome !== null && 'startAt' in outcome ? outcome.startAt : null
  const problem = outcome !== null && 'problem' in outcome && !health.isFetching ? outcome.problem : null

  useEffect(() => {
    if (startAt !== null) {
      void bridge().finishStartup(startAt)
    }
  }, [startAt])

  return (
    <div className="flex h-screen flex-col bg-chrome-accountant px-11 pt-10 pb-8 text-surface [-webkit-app-region:drag]">
      <div className="flex items-center gap-4.5">
        <Crest width={66} />
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-[34px] leading-none font-semibold">{en.appName}</h1>
          <p className="text-surface/70">{en.tagline}</p>
        </div>
      </div>

      {problem !== null && savedUrl !== null ? (
        <div
          role="alert"
          className="mt-auto flex flex-col gap-2 rounded-lg bg-surface px-4.5 py-4 text-ink [-webkit-app-region:no-drag]"
        >
          <strong className="text-[15px] text-bad">{problem.title}</strong>
          {problem.help !== null && <p className="text-[13px] leading-normal text-ink-soft">{problem.help}</p>}
          <div className="mt-0.5 flex flex-wrap gap-2">
            <Button className="h-9 text-[13px]" onClick={() => void health.refetch()}>
              {words.tryAgain}
            </Button>
            <CopyDetailsButton
              className="h-9 text-[13px]"
              details={() =>
                errorDetails(problem, {
                  version: version.data,
                  computerName: computerName.data,
                  serverUrl: savedUrl,
                  at: new Date(),
                })
              }
            />
            <Button variant="secondary" className="h-9 text-[13px]" onClick={() => void bridge().finishStartup('setup')}>
              {words.changeAddress}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-auto flex flex-col gap-3">
          <ol aria-label={words.steps} className="flex flex-col gap-1.5 text-[13px]">
            <li className="flex items-center gap-2.5 text-surface/85">
              <Check aria-hidden="true" className="size-4" strokeWidth={2.5} />
              {words.opening}
            </li>
            {savedUrl !== null && (
              <li className="flex items-center gap-2.5 text-surface">
                <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" strokeWidth={2.5} />
                {words.connecting(addressOf(savedUrl))}
              </li>
            )}
          </ol>
          <div role="progressbar" aria-label={words.progress} className="h-1 overflow-hidden rounded-sm bg-chrome-accountant-active">
            <div className="h-1 w-2/5 animate-sweep rounded-sm bg-surface motion-reduce:animate-none" />
          </div>
        </div>
      )}

      <div className="mt-3.5 flex justify-between text-xs text-surface/70">
        <span>{en.workstation}</span>
        {version.data !== undefined && <span>{en.version(version.data)}</span>}
      </div>
    </div>
  )
}
