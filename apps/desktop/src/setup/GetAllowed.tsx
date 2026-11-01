import { formatKathmanduTime } from '@mikey/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleAlert, CircleCheck, Clock } from 'lucide-react'
import { useEffect } from 'react'

import { addressOf } from '../../electron/server-address.ts'
import { api } from '../api/client.ts'
import { bridge } from '../bridge.ts'
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert.tsx'
import { Button } from '../components/ui/button.tsx'
import { databaseDownProblem, type Problem, problemOf } from '../connection.ts'
import { en } from '../i18n/en.ts'
import type { ServerInfo } from './Setup.tsx'
import { StepNav } from './StepNav.tsx'

const words = en.setup.allow

// ARCHITECTURE.md, Allowed computers: the request is sent again once a minute while it is
// pending, and /health is asked every 5 seconds until it says this computer is allowed.
const REQUEST_REPEAT_MS = 60_000
const HEALTH_POLL_MS = 5_000
const HEALTH_TIMEOUT_MS = 4_000

function timeOf(decidedAt: string | null): string | null {
  return decidedAt === null ? null : formatKathmanduTime(new Date(decidedAt))
}

// Step 3. Asks Computer 1 to allow this computer and waits for the Super Admin's answer.
export function GetAllowed({
  serverUrl,
  onBack,
  onContinue,
}: {
  serverUrl: string
  onBack: () => void
  onContinue: (server: ServerInfo) => void
}) {
  const queryClient = useQueryClient()
  const computerName = useQuery({
    queryKey: ['computer-name'],
    queryFn: () => bridge().computerName(),
    staleTime: Infinity,
  })
  const name = computerName.data ?? null
  const requestKey = ['connection-request', serverUrl]
  const request = useQuery({
    queryKey: requestKey,
    queryFn: () => api.call('requestConnection', { body: { computerName: name ?? '', askAgain: false } }),
    enabled: name !== null,
    refetchInterval: (query) => (query.state.data?.status === 'pending' ? REQUEST_REPEAT_MS : false),
  })
  const status = request.data?.status ?? null
  const health = useQuery({
    queryKey: ['health', serverUrl],
    queryFn: () => api.call('health', { timeoutMs: HEALTH_TIMEOUT_MS }),
    refetchInterval: status === 'allowed' ? false : HEALTH_POLL_MS,
  })
  const askAgain = useMutation({
    mutationFn: () => api.call('requestConnection', { body: { computerName: name ?? '', askAgain: true } }),
    onSuccess: (reply) => queryClient.setQueryData(requestKey, reply),
  })

  // /health says when the Super Admin has allowed this computer; asking once more says when.
  const allowedNow = health.data?.db === 'ok' && health.data.allowed
  const { refetch: askStatus } = request
  useEffect(() => {
    if (allowedNow && status === 'pending') {
      void askStatus()
    }
  }, [allowedNow, status, askStatus])

  const address = addressOf(serverUrl)
  let problem: Problem | null = null
  if (request.isError) {
    problem = problemOf(request.error, address)
  } else if (askAgain.isError) {
    problem = problemOf(askAgain.error, address)
  } else if (health.isError) {
    problem = problemOf(health.error, address)
  } else if (health.data?.db === 'down') {
    problem = databaseDownProblem(health.data)
  }

  const server = health.data?.db === 'ok' ? health.data : null
  const decidedAt = timeOf(request.data?.decidedAt ?? null)
  const title = status === 'allowed' ? words.allowedTitle : status === 'declined' ? words.declinedTitle : words.waitingTitle

  return (
    <>
      <section className="flex flex-col gap-5">
        <h1 className="font-display text-[34px] font-semibold">{title}</h1>
        {status === 'allowed' && (
          <Alert variant="ok" className="px-4.5 py-4 text-[15px]">
            <CircleCheck aria-hidden="true" />
            <AlertTitle>{words.allowedAt(decidedAt)}</AlertTitle>
          </Alert>
        )}
        {status === 'declined' && (
          <div className="flex flex-col items-start gap-4">
            <Alert variant="warn">
              <Clock aria-hidden="true" />
              <div>
                <AlertTitle>{words.declinedAt(decidedAt)}</AlertTitle>
                <AlertDescription>{words.declinedHelp}</AlertDescription>
              </div>
            </Alert>
            <Button disabled={askAgain.isPending} onClick={() => askAgain.mutate()}>
              {words.askAgain}
            </Button>
          </div>
        )}
        {status !== 'allowed' && status !== 'declined' && (
          <div className="flex flex-col gap-4">
            <p className="text-[15px] leading-relaxed text-ink-soft">
              {words.intro.before}
              <strong className="text-ink">{words.intro.place}</strong>
              {words.intro.after}
            </p>
            <div className="flex flex-wrap items-center gap-4 rounded-lg border border-line bg-surface p-4.5">
              <span
                aria-hidden="true"
                className="size-6.5 animate-spin rounded-full border-3 border-line border-t-action motion-reduce:animate-none"
              />
              <div className="flex min-w-50 flex-1 flex-col gap-0.5">
                <span className="text-[13px] text-ink-muted">{words.thisComputer}</span>
                <strong className="text-xl tabular-nums">
                  {name !== null && request.data !== undefined ? words.nameAndIp(name, request.data.ip) : name}
                </strong>
              </div>
              <Button
                variant="secondary"
                onClick={() => {
                  void request.refetch()
                  void health.refetch()
                }}
              >
                {words.checkAgain}
              </Button>
            </div>
            <span className="text-[13px] text-ink-muted">{words.checking}</span>
          </div>
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
      </section>
      <StepNav
        onBack={onBack}
        canContinue={status === 'allowed' && server !== null}
        onContinue={() => {
          if (server !== null) {
            onContinue({ serverName: server.serverName, schoolName: server.schoolName })
          }
        }}
      />
    </>
  )
}
