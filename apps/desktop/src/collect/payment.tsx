import type {
  CollectPaymentRequest,
  CollectPaymentResponse,
  DueItem,
  PaymentMethod,
  Receipt,
  ReceiptPreview,
  StudentRef,
  StudentSummary,
} from '@mikey/shared'
import { useQueryClient } from '@tanstack/react-query'
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

import { api, ApiError, ReplyNotUnderstoodError, UnreachableError } from '../api/client.ts'
import { bridge } from '../bridge.ts'
import { en } from '../i18n/en.ts'

const words = en.collect

// The student a payment is for. From a dashboard row only the reference is known at first.
export interface ChosenStudent {
  ref: StudentRef
  summary: StudentSummary | null
}

// The Collect fee form as it is filled in.
export interface Draft {
  student: ChosenStudent
  // The amount typed for each ticked due, by dueKey.
  ticked: Readonly<Record<string, string>>
  method: PaymentMethod
  reference: string
  // Only for working out the change to give back; never sent.
  cashReceived: string
}

export interface Owner {
  id: string
  fullName: string
}

// Sent, with no answer that says whether it was saved. 'auto': no reply came, or the session
// ended; it is sent again by itself once its owner is signed in and Computer 1 answers. 'manual':
// Computer 1 answered with something this app cannot use; it is sent again with Send again.
export type Unconfirmed = { kind: 'waiting'; since: number } & ({ retry: 'auto' } | { retry: 'manual'; problem: string })

export type PrintState = { kind: 'printing' } | { kind: 'printed' } | { kind: 'failed'; message: string } | Unconfirmed

// `again`: sent once already with no answer, so it is still not confirmed while it goes.
export type Stage =
  | { kind: 'sending'; again: boolean }
  | Unconfirmed
  | { kind: 'saved'; receipt: Receipt; printKey: string; print: PrintState }

// A confirmed payment, from Confirm until its original has printed: the form as it was confirmed
// and the one request that is sent for it, with its idempotency key, however many times it goes.
export interface Pending {
  owner: Owner
  draft: Draft
  dues: readonly DueItem[]
  preview: ReceiptPreview
  request: CollectPaymentRequest
  stage: Stage
}

export interface LastSaved {
  receiptNo: string
  issuedAt: string
}

interface CollectValue {
  draft: Draft | null
  pending: Pending | null
  // Why Computer 1 refused the last payment, until the form is changed.
  refusal: string | null
  lastSaved: LastSaved | null
  // Starts the form for a student, unless a payment is not finished: that blocks a new one.
  start: (student: ChosenStudent) => void
  edit: (change: (draft: Draft) => Draft) => void
  clearStudent: () => void
  confirm: (payment: Omit<Pending, 'stage'>) => void
  sendAgain: () => void
  printAgain: () => void
  // After the save, for the next student.
  next: () => void
  // At sign-out: nothing of the form stays, but a payment not finished does (ARCHITECTURE.md).
  forgetDraft: () => void
}

const CollectContext = createContext<CollectValue | null>(null)

export function useCollect(): CollectValue {
  const value = useContext(CollectContext)
  if (value === null) {
    throw new Error('useCollect is used outside CollectProvider.')
  }
  return value
}

export function dueKey(due: DueItem): string {
  return due.kind === 'fee' ? `fee:${due.feeDueId}` : `fine:${due.fineId}`
}

// A refusal saying a due is no longer owed as the screen shows it: paid, perhaps at the other
// counter, cancelled or waived. The dues are then read again, so the screen shows the truth.
const DUE_GONE = new Set(['DUE_ALREADY_PAID', 'DUE_NOT_OWED', 'NOT_FOUND'])

export function dueGone(error: unknown): boolean {
  return error instanceof ApiError && DUE_GONE.has(error.code)
}

// A payment the preview allowed but Computer 1 then refused for its dues: they changed meanwhile.
function duesChanged(error: ApiError): boolean {
  return dueGone(error) || error.code === 'AMOUNT_EXCEEDS_DUE'
}

type Outcome = { kind: 'refused'; error: ApiError } | Unconfirmed

// What a failed request about a payment means. Only a refusal says for certain that nothing was
// saved; with no answer, an ended session or an answer that cannot be used, it may have been.
function outcomeOf(error: unknown): Outcome {
  const since = Date.now()
  if (error instanceof UnreachableError || (error instanceof ApiError && error.status === 401)) {
    return { kind: 'waiting', since, retry: 'auto' }
  }
  if (error instanceof ApiError) {
    return error.status >= 500 ? { kind: 'waiting', since, retry: 'manual', problem: error.message } : { kind: 'refused', error }
  }
  if (error instanceof ReplyNotUnderstoodError) {
    return { kind: 'waiting', since, retry: 'manual', problem: en.connection.notUnderstood }
  }
  throw error
}

// Finished: saved, and its original printed, or past trying by itself.
export function isSettled(pending: Pending): boolean {
  if (pending.stage.kind !== 'saved') {
    return false
  }
  const { print } = pending.stage
  return print.kind === 'printed' || print.kind === 'failed' || (print.kind === 'waiting' && print.retry === 'manual')
}

function newDraft(student: ChosenStudent): Draft {
  return { student, ticked: {}, method: 'cash', reference: '', cashReceived: '' }
}

// Asks for the original and prints it. The print key makes asking again safe: the same key gets
// the same PDF and uses up nothing more (DOMAIN_RULES §5).
async function printOriginal(paymentId: string, printKey: string): Promise<PrintState> {
  let pdf: Uint8Array
  try {
    pdf = await api.call('printReceipt', { params: { paymentId }, body: { printKey } })
  } catch (error) {
    const outcome = outcomeOf(error)
    return outcome.kind === 'refused' ? { kind: 'failed', message: outcome.error.message } : outcome
  }
  const result = await bridge().printPdf(pdf, await bridge().getPrinter())
  return result.printed ? { kind: 'printed' } : { kind: 'failed', message: words.saved.printFailed }
}

// The payment being collected. It sits above the session, so a payment Computer 1 has not
// confirmed outlives a sign-out and is sent again, with the same key, when its owner is signed in
// and Computer 1 answers (ARCHITECTURE.md, Health and connection status). It is kept in memory
// only: Computer 2 keeps no records.
export function CollectProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [lastSaved, setLastSaved] = useState<LastSaved | null>(null)
  // One request about the payment at a time: a double click, or a resend while one is out, sends
  // nothing more.
  const busy = useRef(false)

  const setPrint = useCallback((print: PrintState) => {
    setPending((current) => (current?.stage.kind === 'saved' ? { ...current, stage: { ...current.stage, print } } : current))
  }, [])

  const print = useCallback(
    async (paymentId: string, printKey: string) => {
      if (busy.current) {
        return
      }
      busy.current = true
      setPrint({ kind: 'printing' })
      try {
        setPrint(await printOriginal(paymentId, printKey))
      } finally {
        busy.current = false
      }
    },
    [setPrint],
  )

  const send = useCallback(
    async (payment: Omit<Pending, 'stage'>, again: boolean) => {
      if (busy.current) {
        return
      }
      busy.current = true
      setPending({ ...payment, stage: { kind: 'sending', again } })
      let answer: CollectPaymentResponse | Outcome
      try {
        answer = await api.call('collectPayment', { body: payment.request })
      } catch (error) {
        answer = outcomeOf(error)
      } finally {
        busy.current = false
      }
      if ('receipt' in answer) {
        const { receipt } = answer
        const printKey = crypto.randomUUID()
        setLastSaved({ receiptNo: receipt.snapshot.receiptNo, issuedAt: receipt.snapshot.issuedAt })
        setPending({ ...payment, stage: { kind: 'saved', receipt, printKey, print: { kind: 'printing' } } })
        // What students owe and today's figures have changed.
        void queryClient.invalidateQueries({ queryKey: ['students'] })
        void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
        void print(receipt.paymentId, printKey)
      } else if (answer.kind === 'waiting') {
        setPending({ ...payment, stage: answer })
      } else {
        // Nothing was saved: the form comes back as it was, with the reason.
        setPending(null)
        setDraft(payment.draft)
        setRefusal(answer.error.message)
        if (duesChanged(answer.error)) {
          void queryClient.invalidateQueries({ queryKey: ['students', payment.request.studentId, 'dues'] })
        }
      }
    },
    [print, queryClient],
  )

  // Closing the app while a payment is not confirmed asks first: it lives only in this window.
  const unconfirmed = pending?.stage.kind === 'sending' || pending?.stage.kind === 'waiting'
  useEffect(() => {
    void bridge().setCloseWarning(unconfirmed ? words.closeWarning : null)
  }, [unconfirmed])

  const forgetDraft = useCallback(() => {
    setDraft(null)
    setRefusal(null)
    setPending((current) => (current !== null && isSettled(current) ? null : current))
  }, [])

  const value = useMemo<CollectValue>(
    () => ({
      draft,
      pending,
      refusal,
      lastSaved,
      start(student) {
        if (pending !== null && !isSettled(pending)) {
          return
        }
        setPending(null)
        setRefusal(null)
        setDraft((current) =>
          pending === null && current?.student.ref.id === student.ref.id
            ? { ...current, student: { ref: student.ref, summary: student.summary ?? current.student.summary } }
            : newDraft(student),
        )
      },
      edit(change) {
        if (pending === null) {
          setDraft((current) => (current === null ? null : change(current)))
          setRefusal(null)
        }
      },
      clearStudent() {
        if (pending === null) {
          setDraft(null)
          setRefusal(null)
        }
      },
      confirm(payment) {
        setRefusal(null)
        void send(payment, false)
      },
      sendAgain() {
        if (pending?.stage.kind === 'waiting') {
          void send(pending, true)
        }
      },
      printAgain() {
        if (pending?.stage.kind === 'saved' && pending.stage.print.kind === 'waiting') {
          void print(pending.stage.receipt.paymentId, pending.stage.printKey)
        }
      },
      next() {
        if (pending !== null && isSettled(pending)) {
          setPending(null)
          setDraft(null)
          setRefusal(null)
        }
      },
      forgetDraft,
    }),
    [draft, pending, refusal, lastSaved, send, print, forgetDraft],
  )

  return <CollectContext value={value}>{children}</CollectContext>
}

// True from Confirm until the payment is finished; the app does not sign out by itself meanwhile.
export function usePaymentUnfinished(): boolean {
  const { pending } = useCollect()
  return pending !== null && !isSettled(pending)
}

// In the signed-in frame: a payment, or its original, that got no answer is sent again by itself
// once its owner is signed in and Computer 1 has answered after the last try.
export function useSendAgainWhenBack(userId: string, answeredAt: number | null): void {
  const { pending, sendAgain, printAgain } = useCollect()
  useEffect(() => {
    if (pending === null || pending.owner.id !== userId || answeredAt === null) {
      return
    }
    const { stage } = pending
    if (stage.kind === 'waiting' && stage.retry === 'auto' && answeredAt > stage.since) {
      sendAgain()
    } else if (stage.kind === 'saved' && stage.print.kind === 'waiting' && stage.print.retry === 'auto' && answeredAt > stage.print.since) {
      printAgain()
    }
  }, [pending, userId, answeredAt, sendAgain, printAgain])
}
