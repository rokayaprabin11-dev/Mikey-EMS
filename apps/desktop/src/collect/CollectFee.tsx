import {
  type AdDate,
  adToBs,
  type CollectPaymentRequest,
  type DueItem,
  formatBsDateLong,
  formatRupees,
  formatRupeesInput,
  InvalidAmountError,
  kathmanduDate,
  parseRupees,
  type PaymentMethod,
  paymentPreviewRequestSchema,
  printEn,
  type Session,
  type StudentSummary,
} from '@mikey/shared'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { cn } from 'cn'
import { Check, CircleAlert, CircleCheck } from 'lucide-react'
import { type ReactNode, type Ref, useCallback, useEffect, useId, useRef, useState } from 'react'

import { api } from '../api/client.ts'
import { MoneyInput } from '../components/MoneyInput.tsx'
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert.tsx'
import { Button } from '../components/ui/button.tsx'
import { Checkbox } from '../components/ui/checkbox.tsx'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../components/ui/dialog.tsx'
import { Input } from '../components/ui/input.tsx'
import { Label } from '../components/ui/label.tsx'
import { RadioButton, RadioGroup } from '../components/ui/radio-group.tsx'
import { problemOf } from '../connection.ts'
import { useLink } from '../frame/link.tsx'
import { StudentSearch } from '../frame/StudentSearch.tsx'
import { en } from '../i18n/en.ts'
import { initials } from '../initials.ts'
import { type ChosenStudent, type Draft, dueGone, dueKey, isSettled, type Pending, useCollect } from './payment.tsx'
import { type ReceiptFace, ReceiptFaceView, ReceiptPaper, SavedReceipt, snapshotFace } from './ReceiptCard.tsx'
import { WaitingPayment } from './WaitingPayment.tsx'

const words = en.collect

// The design's order. DOMAIN_RULES §4 lists the same six; Q17 may hide some later.
const METHODS = ['cash', 'fonepay', 'bank_deposit', 'esewa', 'khalti', 'cheque'] as const satisfies readonly PaymentMethod[]

// Waits for a pause in typing before asking Computer 1 for the receipt.
const PAUSE_MS = 250

type Allocation = CollectPaymentRequest['allocations'][number]

interface Amounts {
  allocations: Allocation[]
  // Why a ticked amount cannot be read, by dueKey.
  problems: Record<string, string>
}

// The ticked dues, oldest first, with the amounts as typed. Reading them is the screen's only
// part in the money: Computer 1 works out the receipt.
function readAmounts(dues: readonly DueItem[], ticked: Draft['ticked']): Amounts {
  const allocations: Allocation[] = []
  const problems: Record<string, string> = {}
  for (const due of dues) {
    const key = dueKey(due)
    const typed = ticked[key]
    if (typed === undefined) {
      continue
    }
    let amount: number
    try {
      amount = parseRupees(typed)
    } catch (error) {
      if (!(error instanceof InvalidAmountError)) {
        throw error
      }
      problems[key] = words.dues.notAnAmount
      continue
    }
    if (amount === 0) {
      problems[key] = words.dues.zero
    } else {
      allocations.push(due.kind === 'fee' ? { kind: 'fee', feeDueId: due.feeDueId, amount } : { kind: 'fine', fineId: due.fineId, amount })
    }
  }
  return { allocations, problems }
}

// Cash received is optional; when typed, the change is the one sum this screen does (DOMAIN_RULES
// §4): it is shown and never saved.
type Change = { kind: 'none' } | { kind: 'notAnAmount' } | { kind: 'short' | 'return' | 'exact'; amount: number }

function changeFor(cashReceived: string, amountPaid: number | null): Change {
  if (cashReceived.trim() === '') {
    return { kind: 'none' }
  }
  let received: number
  try {
    received = parseRupees(cashReceived)
  } catch (error) {
    if (error instanceof InvalidAmountError) {
      return { kind: 'notAnAmount' }
    }
    throw error
  }
  if (amountPaid === null) {
    return { kind: 'none' }
  }
  if (received < amountPaid) {
    return { kind: 'short', amount: amountPaid - received }
  }
  return received > amountPaid ? { kind: 'return', amount: received - amountPaid } : { kind: 'exact', amount: 0 }
}

// The text after a pause, so a request is not sent for every key.
function usePaused(text: string | null): string | null {
  const [paused, setPaused] = useState(text)
  useEffect(() => {
    const timer = setTimeout(() => setPaused(text), PAUSE_MS)
    return () => clearTimeout(timer)
  }, [text])
  return paused
}

// Moves the focus now, or once what it moves to is on the screen.
function useFocusLater(): (find: () => HTMLElement | null | undefined) => void {
  const target = useRef<(() => HTMLElement | null | undefined) | null>(null)
  useEffect(() => {
    const element = target.current?.()
    if (element) {
      target.current = null
      element.focus()
    }
  })
  return useCallback((find) => {
    const element = find()
    if (element) {
      target.current = null
      element.focus()
    } else {
      target.current = find
    }
  }, [])
}

function Steps({ current }: { current: number }) {
  return (
    <ol aria-label={words.steps} className="flex flex-wrap gap-x-4.5 gap-y-1.5 text-[13px]">
      {words.stepNames.map((name, index) => {
        const done = index < current
        const now = index === current
        return (
          <li
            key={name}
            aria-current={now ? 'step' : undefined}
            className={cn('flex items-center gap-2', done || now ? 'text-ink' : 'text-ink-muted', now && 'font-semibold')}
          >
            <span
              aria-hidden="true"
              className={cn(
                'grid size-5.5 place-items-center rounded-full text-xs',
                done && 'bg-ok text-surface',
                now && 'bg-ink text-surface',
                !done && !now && 'bg-neutral-tint text-ink-muted',
              )}
            >
              {done ? <Check className="size-3.5" strokeWidth={3} /> : index + 1}
            </span>
            {name}
            {done && <span className="sr-only">{` (${words.stepDone})`}</span>}
          </li>
        )
      })}
    </ol>
  )
}

function StudentCard({ student, summary, onChange }: { student: ChosenStudent; summary: StudentSummary | null; onChange: () => void }) {
  const { ref } = student
  let details: string = words.student.loading
  if (summary !== null) {
    const place = words.student.details(summary.code, summary.className, summary.sectionName, summary.rollNo)
    details = summary.guardianName === null ? place : `${place} ${words.student.guardian(summary.guardianName, summary.guardianPhone)}`
  }
  return (
    <div className="flex flex-wrap items-center gap-3.5 rounded-md bg-paper px-3.5 py-3">
      <span aria-hidden="true" className="grid size-11 flex-none place-items-center rounded-md bg-neutral-tint font-semibold">
        {initials(ref.fullName)}
      </span>
      <div className="flex min-w-50 flex-1 flex-col gap-0.5">
        <span className="text-base font-semibold">{ref.fullName}</span>
        <span className="text-[13px] text-ink-muted">{details}</span>
      </div>
      <Button variant="secondary" onClick={onChange}>
        {words.student.change}
      </Button>
    </div>
  )
}

function without(ticked: Draft['ticked'], key: string): Draft['ticked'] {
  return Object.fromEntries(Object.entries(ticked).filter(([item]) => item !== key))
}

// Every due ticked; a due already ticked keeps the amount typed for it.
function tickAll(dues: readonly DueItem[], ticked: Draft['ticked']): Draft['ticked'] {
  return Object.fromEntries(dues.map((due) => [dueKey(due), ticked[dueKey(due)] ?? formatRupeesInput(due.remaining)]))
}

function dueLabel(due: DueItem): string {
  return due.kind === 'fee' ? `${due.headName}, ${due.periodLabel}` : due.reason
}

function DueRow({
  due,
  typed,
  problem,
  today,
  onTick,
  onAmount,
}: {
  due: DueItem
  typed: string | undefined
  problem: string | undefined
  today: AdDate | null
  onTick: (due: DueItem, ticked: boolean) => void
  onAmount: (due: DueItem, typed: string) => void
}) {
  const id = useId()
  const label = dueLabel(due)
  const ticked = typed !== undefined
  let note: string = words.dues.fine
  let overdue = false
  if (due.kind === 'fee') {
    overdue = today !== null && due.dueDate < today
    const date = formatBsDateLong(adToBs(due.dueDate))
    const parts = [overdue ? words.dues.overdueSince(date) : words.dues.dueBy(date)]
    if (due.discount > 0) {
      parts.push(words.dues.discount(formatRupees(due.discount)))
    }
    if (due.paid > 0) {
      parts.push(words.dues.paidBefore(formatRupees(due.paid)))
    }
    note = parts.join('. ')
  }
  return (
    <li className={cn('flex items-center gap-3 border-t border-line-soft px-4.5 py-2.5', !ticked && 'bg-surface-muted')}>
      <Checkbox id={`${id}-tick`} checked={ticked} onCheckedChange={(checked) => onTick(due, checked === true)} aria-label={words.dues.pay(label)} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <label htmlFor={`${id}-tick`} className="cursor-pointer font-semibold">
          {label}
        </label>
        <span className={cn('text-[12.5px]', overdue ? 'text-warn' : 'text-ink-muted')}>{note}</span>
        {problem !== undefined && (
          <span id={`${id}-problem`} className="text-[12.5px] text-bad">
            {problem}
          </span>
        )}
      </div>
      <span className="text-[13px] whitespace-nowrap text-ink-muted tabular-nums">{words.dues.of(formatRupees(due.remaining))}</span>
      <MoneyInput
        className="w-32.5 flex-none"
        value={typed ?? ''}
        disabled={!ticked}
        invalid={problem !== undefined}
        aria-label={words.dues.amountFor(label)}
        aria-describedby={problem === undefined ? undefined : `${id}-problem`}
        onChange={(event) => onAmount(due, event.target.value)}
      />
    </li>
  )
}

function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn('rounded-lg border border-line bg-surface', className)}>{children}</section>
}

function ProblemAlert({ title, help }: { title: string; help: string | null }) {
  return (
    <Alert variant="bad">
      <CircleAlert aria-hidden="true" />
      <div>
        <AlertTitle>{title}</AlertTitle>
        {help !== null && <AlertDescription>{help}</AlertDescription>}
      </div>
    </Alert>
  )
}

function HowPaid({
  draft,
  change,
  onChange,
}: {
  draft: Draft
  change: Change
  onChange: (change: Partial<Pick<Draft, 'method' | 'reference' | 'cashReceived'>>) => void
}) {
  const id = useId()
  const { method } = draft
  let changeText: string | null = null
  if (change.kind === 'short') {
    changeText = words.paid.shortBy(formatRupees(change.amount))
  } else if (change.kind === 'return') {
    changeText = words.paid.returnToParent(formatRupees(change.amount))
  } else if (change.kind === 'exact') {
    changeText = words.paid.exact
  }
  return (
    <Panel className="flex flex-col gap-3.5 px-4.5 pt-3.5 pb-4.5">
      <h2 className="font-display text-xl font-semibold">{words.paid.title}</h2>
      <RadioGroup
        aria-label={words.paid.method}
        value={method}
        onValueChange={(value) => onChange({ method: METHODS.find((item) => item === value) ?? 'cash' })}
        className="flex flex-wrap gap-2"
      >
        {METHODS.map((item) => (
          <RadioButton key={item} value={item}>
            {printEn.paymentMethods[item]}
          </RadioButton>
        ))}
      </RadioGroup>
      {method === 'cash' ? (
        <div className="flex flex-wrap items-start gap-x-4.5 gap-y-2">
          <div className="flex w-60 flex-col gap-1.5">
            <Label htmlFor={`${id}-cash`}>{words.paid.cashReceived}</Label>
            <MoneyInput
              id={`${id}-cash`}
              className="h-10.5 text-base"
              value={draft.cashReceived}
              invalid={change.kind === 'notAnAmount'}
              aria-describedby={`${id}-cash-help`}
              onChange={(event) => onChange({ cashReceived: event.target.value })}
            />
            <span id={`${id}-cash-help`} className={cn('text-[12.5px]', change.kind === 'notAnAmount' ? 'text-bad' : 'text-ink-muted')}>
              {change.kind === 'notAnAmount' ? words.paid.notAnAmount : words.paid.cashHelp}
            </span>
          </div>
          <p
            aria-live="polite"
            className={cn('pt-6 font-display text-[22px] font-semibold tabular-nums', change.kind === 'short' ? 'text-bad' : 'text-ink')}
          >
            {changeText}
          </p>
        </div>
      ) : (
        <div className="flex max-w-90 flex-col gap-1.5">
          <Label htmlFor={`${id}-reference`}>{words.paid.reference[method]}</Label>
          <Input
            id={`${id}-reference`}
            value={draft.reference}
            maxLength={100}
            autoComplete="off"
            aria-describedby={`${id}-reference-help`}
            onChange={(event) => onChange({ reference: event.target.value })}
          />
          <span id={`${id}-reference-help`} className="text-[12.5px] text-ink-muted">
            {words.paid.referenceHelp}
          </span>
        </div>
      )}
    </Panel>
  )
}

function Shortcut({ keys }: { keys: string }) {
  return (
    <span aria-hidden="true" className="text-[13px] font-normal opacity-85">
      {keys}
    </span>
  )
}

function ConfirmPanel({
  pending,
  amount,
  method,
  student,
  confirmRef,
  onBack,
  onConfirm,
}: {
  pending: boolean
  amount: number
  method: PaymentMethod
  student: ChosenStudent
  confirmRef: Ref<HTMLButtonElement>
  onBack: () => void
  onConfirm: () => void
}) {
  const id = useId()
  return (
    <section
      role="alertdialog"
      aria-label={words.confirm.label}
      aria-describedby={`${id}-text`}
      className="flex flex-col gap-3 rounded-lg border-2 border-ink bg-surface px-4.5 py-4"
    >
      <h3 className="font-display text-xl font-semibold">{words.confirm.title(formatRupees(amount), words.byMethod[method])}</h3>
      <p id={`${id}-text`} className="text-[13.5px] leading-normal">
        {words.confirm.text(student.ref.fullName, student.ref.className, student.ref.sectionName)}
      </p>
      <div className="flex gap-2.5">
        <Button variant="secondary" size="lg" className="flex-1" disabled={pending} aria-keyshortcuts="Escape" onClick={onBack}>
          {words.confirm.back}
          <Shortcut keys={words.confirm.backKeys} />
        </Button>
        <Button ref={confirmRef} size="lg" className="flex-2" disabled={pending} aria-keyshortcuts="Control+Enter" onClick={onConfirm}>
          {pending ? words.confirm.saving : words.confirm.confirm}
          {!pending && <Shortcut keys={words.confirm.confirmKeys} />}
        </Button>
      </div>
    </section>
  )
}

function SavedPanel({
  pending,
  nextRef,
  onView,
}: {
  pending: Pending & { stage: { kind: 'saved' } }
  nextRef: Ref<HTMLButtonElement>
  onView: () => void
}) {
  const { printAgain, next } = useCollect()
  const { receipt, print } = pending.stage
  const receiptNo = receipt.snapshot.receiptNo
  let title = words.saved.notPrinted(receiptNo)
  let more: ReactNode = null
  if (print.kind === 'printing') {
    title = words.saved.printing(receiptNo)
  } else if (print.kind === 'printed') {
    title = words.saved.printed(receiptNo)
  } else if (print.kind === 'failed') {
    more = <p className="text-[13.5px] font-semibold text-bad">{print.message}</p>
  } else if (print.retry === 'auto') {
    more = <p className="text-[13.5px] text-ink-soft">{words.saved.printLater}</p>
  } else {
    more = (
      <div className="flex flex-col items-start gap-2">
        <p className="text-[13.5px] text-ink-soft">{words.saved.printUnsure(print.problem)}</p>
        <Button variant="secondary" onClick={printAgain}>
          {words.saved.printAgain}
        </Button>
      </div>
    )
  }
  return (
    <section role="status" className="flex flex-col gap-2.5 rounded-lg border border-ok/40 bg-ok-tint px-4.5 py-4">
      <div className="flex items-start gap-2.5">
        <CircleCheck aria-hidden="true" className="mt-0.5 size-5.5 flex-none text-ok" />
        <strong className="text-[15px] font-semibold text-ok">{title}</strong>
      </div>
      {more}
      <div className="flex flex-wrap gap-2.5">
        <Button variant="secondary" className="border-ok text-ok" onClick={onView}>
          {words.saved.view}
        </Button>
        <Button ref={nextRef} className="bg-ok hover:bg-ok/90" disabled={!isSettled(pending)} onClick={next}>
          {words.saved.next}
        </Button>
      </div>
    </section>
  )
}

// Collect fee (DOMAIN_RULES §4, docs/DESIGN_SYSTEM.md, Screen patterns): find the student, tick
// the dues, take the payment, then confirm and print. Every amount and word on the receipt comes
// from Computer 1; the screen reads what is typed and works out only the change for cash.
export function CollectFee({ session }: { session: Session }) {
  const collect = useCollect()
  const queryClient = useQueryClient()
  const link = useLink()
  const { pending, refusal } = collect
  const draft = pending?.draft ?? collect.draft
  const frozen = pending !== null
  const student = draft?.student ?? null
  const studentId = student?.ref.id ?? null
  const root = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const reviewButton = useRef<HTMLButtonElement>(null)
  const confirmButton = useRef<HTMLButtonElement>(null)
  const nextButton = useRef<HTMLButtonElement>(null)
  const focusLater = useFocusLater()
  // The payment's idempotency key, made when the review opens (DOMAIN_RULES §4).
  const [review, setReview] = useState<string | null>(null)
  const [viewing, setViewing] = useState(false)

  const health = link.last?.check.health
  const today = health === undefined ? null : kathmanduDate(new Date(health.time))
  const school = (health?.db === 'ok' ? health.schoolName : null) ?? en.appName

  // Read when the student is chosen, and again only when Computer 1 says a due went meanwhile.
  const duesQuery = useQuery({
    queryKey: ['students', studentId, 'dues'],
    queryFn: () => api.call('studentDues', { params: { studentId: studentId ?? '' } }),
    enabled: studentId !== null,
  })
  // From a dashboard row only the student's name and class are known: the rest is looked up.
  const lookup = useQuery({
    queryKey: ['students', studentId, 'fees'],
    queryFn: () => api.call('studentFees', { params: { studentId: studentId ?? '' } }),
    enabled: studentId !== null && student?.summary === null,
  })
  const summary = student?.summary ?? lookup.data?.student ?? null
  const dues = pending?.dues ?? duesQuery.data?.items ?? null

  const amounts = draft !== null && dues !== null ? readAmounts(dues, draft.ticked) : { allocations: [], problems: {} }
  const readable = Object.keys(amounts.problems).length === 0
  const body = studentId === null || !readable ? null : JSON.stringify({ studentId, allocations: amounts.allocations })
  const asked = usePaused(body)
  // Asked only for the dues as they are ticked now, once typing pauses and the dues are read.
  const current = asked !== null && asked === body && amounts.allocations.length > 0 && !duesQuery.isFetching
  const preview = useQuery({
    queryKey: ['payment-preview', asked],
    queryFn: () => api.call('previewPayment', { body: paymentPreviewRequestSchema.parse(JSON.parse(asked ?? '')) }),
    enabled: !frozen && current,
    placeholderData: keepPreviousData,
  })
  // The receipt shown is the one for the dues as ticked now, not an earlier one.
  const upToDate = current && preview.isSuccess && !preview.isPlaceholderData
  const amountPaid = upToDate ? preview.data.totals.amountPaid : null

  // A due that went meanwhile: the dues are read again, once for each receipt that was refused.
  const { error: previewError } = preview
  const reloadedFor = useRef<string | null>(null)
  useEffect(() => {
    if (dueGone(previewError) && reloadedFor.current !== asked) {
      reloadedFor.current = asked
      void queryClient.invalidateQueries({ queryKey: ['students', studentId, 'dues'] })
    }
  }, [previewError, asked, queryClient, studentId])

  const method = draft?.method ?? 'cash'
  const change = changeFor(method === 'cash' ? (draft?.cashReceived ?? '') : '', amountPaid)
  const referenceMissing = method !== 'cash' && (draft?.reference.trim() ?? '') === ''
  const canReview = !frozen && review === null && upToDate && change.kind !== 'short' && change.kind !== 'notAnAmount' && !referenceMissing

  // A new student: the dues get the focus once they are on the screen; no student: the search.
  useEffect(() => {
    if (frozen) {
      return
    }
    focusLater(studentId === null ? () => search.current : () => root.current?.querySelector<HTMLElement>('[data-slot="checkbox"]'))
  }, [studentId, frozen, focusLater])

  const settled = pending !== null && isSettled(pending)
  useEffect(() => {
    if (settled) {
      nextButton.current?.focus()
    }
  }, [settled])

  function openReview(): void {
    if (canReview) {
      setReview(crypto.randomUUID())
      focusLater(() => confirmButton.current)
    }
  }

  function goBack(): void {
    setReview(null)
    focusLater(() => reviewButton.current)
  }

  function confirm(): void {
    if (review === null || !upToDate || draft === null || dues === null || studentId === null) {
      return
    }
    collect.confirm({
      owner: { id: session.user.id, fullName: session.user.fullName },
      draft,
      dues,
      preview: preview.data,
      request: {
        idempotencyKey: review,
        studentId,
        method: draft.method,
        ...(draft.method === 'cash' ? {} : { reference: draft.reference.trim() }),
        allocations: amounts.allocations,
      },
    })
    setReview(null)
  }

  // Ctrl+Enter reviews, and confirms once reviewing; Esc goes back. F2 is the search, as everywhere.
  const keys = useRef({ openReview, confirm, goBack, reviewing: review !== null })
  useEffect(() => {
    keys.current = { openReview, confirm, goBack, reviewing: review !== null }
  })
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'F2') {
        search.current?.focus()
        return
      }
      const inside = event.target instanceof Node && (root.current?.contains(event.target) === true || event.target === document.body)
      if (!inside) {
        return
      }
      if (event.key === 'Enter' && event.ctrlKey) {
        event.preventDefault()
        if (keys.current.reviewing) {
          keys.current.confirm()
        } else {
          keys.current.openReview()
        }
      } else if (event.key === 'Escape' && keys.current.reviewing) {
        event.preventDefault()
        keys.current.goBack()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  let step = 0
  if (pending?.stage.kind === 'saved') {
    step = 4
  } else if (frozen || review !== null) {
    step = 3
  } else if (draft !== null && Object.keys(draft.ticked).length > 0) {
    step = 2
  } else if (draft !== null) {
    step = 1
  }

  let face: ReactNode
  if (pending?.stage.kind === 'saved') {
    face = <ReceiptFaceView face={snapshotFace(pending.stage.receipt.snapshot)} />
  } else if (student === null || draft === null) {
    face = <p className="text-[13px] text-ink-muted">{words.preview.chooseStudent}</p>
  } else if (dues?.length === 0) {
    face = <p className="text-[13px] text-ink-muted">{words.preview.nothingToCollect}</p>
  } else {
    const money = pending?.preview ?? (amounts.allocations.length > 0 && readable ? preview.data : undefined)
    if (money !== undefined && today !== null) {
      const shown: ReceiptFace = {
        number: null,
        date: today,
        student: { ...student.ref, rollNo: summary?.rollNo ?? null },
        money,
        method: draft.method,
        reference: draft.method === 'cash' || draft.reference.trim() === '' ? null : draft.reference.trim(),
        receivedBy: pending?.owner.fullName ?? session.user.fullName,
      }
      face = <ReceiptFaceView face={shown} stale={!frozen && !upToDate} />
    } else if (preview.isError && amounts.allocations.length > 0) {
      const problem = problemOf(preview.error, link.address)
      face = <ProblemAlert title={problem.title} help={problem.help} />
    } else if (amounts.allocations.length > 0) {
      face = <p className="text-[13px] text-ink-muted">{words.preview.working}</p>
    } else {
      face = <p className="text-[13px] text-ink-muted">{words.preview.tickDues}</p>
    }
  }

  let panel: ReactNode = null
  const stage = pending?.stage
  if (pending !== null && stage?.kind === 'saved') {
    panel = <SavedPanel pending={{ ...pending, stage }} nextRef={nextButton} onView={() => setViewing(true)} />
  } else if (pending !== null && (stage?.kind === 'waiting' || (stage?.kind === 'sending' && stage.again))) {
    panel = <WaitingPayment pending={pending} lastSaved={collect.lastSaved} userId={session.user.id} />
  } else if (student !== null && (review !== null || pending !== null)) {
    panel = (
      <ConfirmPanel
        pending={pending !== null}
        amount={pending?.preview.totals.amountPaid ?? amountPaid ?? 0}
        method={draft?.method ?? 'cash'}
        student={student}
        confirmRef={confirmButton}
        onBack={goBack}
        onConfirm={confirm}
      />
    )
  } else if (student !== null && dues?.length !== 0) {
    panel = (
      <>
        {refusal !== null && <ProblemAlert title={words.refused} help={refusal} />}
        <Button
          ref={reviewButton}
          size="xl"
          className="h-14 w-full text-base"
          disabled={!canReview}
          aria-keyshortcuts="Control+Enter"
          onClick={openReview}
        >
          {amountPaid === null ? words.reviewPayment : words.review(formatRupees(amountPaid))}
          <Shortcut keys={words.reviewKeys} />
        </Button>
        <p className="text-[12.5px] leading-normal text-ink-muted">{words.numberNote}</p>
      </>
    )
  }

  let duesContent: ReactNode
  if (dues === null) {
    const problem = duesQuery.isError ? problemOf(duesQuery.error, link.address) : null
    duesContent = problem !== null ? (
      <div className="border-t border-line-soft px-4.5 py-3.5">
        <ProblemAlert title={problem.title} help={problem.help} />
      </div>
    ) : (
      <p className="border-t border-line-soft px-4.5 py-3.5 text-ink-muted">{words.dues.loading}</p>
    )
  } else if (dues.length === 0) {
    duesContent = (
      <div className="flex flex-col gap-1 border-t border-line-soft px-4.5 py-3.5">
        <strong className="font-semibold">{words.dues.none(student?.ref.fullName ?? '')}</strong>
        <span className="text-ink-soft">{words.dues.noneHelp}</span>
      </div>
    )
  } else {
    const allDues = dues
    duesContent = (
      // Ctrl+A in the list ticks every due; in an amount box it still selects the text.
      <ul
        onKeyDown={(event) => {
          if (event.ctrlKey && event.key.toLowerCase() === 'a' && !(event.target instanceof HTMLInputElement)) {
            event.preventDefault()
            collect.edit((current) => ({ ...current, ticked: tickAll(allDues, current.ticked) }))
          }
        }}
      >
        {dues.map((due) => (
          <DueRow
            key={dueKey(due)}
            due={due}
            typed={draft?.ticked[dueKey(due)]}
            problem={amounts.problems[dueKey(due)]}
            today={today}
            onTick={(item, ticked) =>
              collect.edit((current) => ({
                ...current,
                // A ticked due starts at what is still owed on it.
                ticked: ticked ? { ...current.ticked, [dueKey(item)]: formatRupeesInput(item.remaining) } : without(current.ticked, dueKey(item)),
              }))
            }
            onAmount={(item, typed) => collect.edit((current) => ({ ...current, ticked: { ...current.ticked, [dueKey(item)]: typed } }))}
          />
        ))}
      </ul>
    )
  }

  return (
    <div ref={root} className="flex flex-wrap items-start gap-5">
      <div inert={frozen || review !== null} className="flex min-w-0 flex-[3_1_560px] flex-col gap-4">
        <Steps current={step} />
        <Panel className="flex flex-col gap-3 px-4.5 py-4">
          <StudentSearch
            variant="collectFee"
            inputRef={search}
            onChoose={(chosen) => {
              collect.start({ ref: chosen, summary: chosen })
            }}
          />
          {student !== null && (
            <StudentCard
              student={student}
              summary={summary}
              onChange={() => {
                collect.clearStudent()
              }}
            />
          )}
        </Panel>
        {student !== null && (
          <Panel className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4.5 pt-3.5 pb-2">
              <h2 className="font-display text-xl font-semibold">{words.dues.title}</h2>
              <span className="flex-1 text-[13px] text-ink-muted">{words.dues.help}</span>
              {dues !== null && dues.length > 0 && (
                <Button
                  variant="secondary"
                  className="h-8 rounded-sm px-2.5 text-[13px]"
                  aria-keyshortcuts="Control+A"
                  onClick={() => collect.edit((current) => ({ ...current, ticked: tickAll(dues, current.ticked) }))}
                >
                  {words.dues.tickAll}
                  <Shortcut keys={words.dues.tickAllKeys} />
                </Button>
              )}
            </div>
            {duesContent}
          </Panel>
        )}
        {draft !== null && dues !== null && dues.length > 0 && (
          <HowPaid draft={draft} change={change} onChange={(changed) => collect.edit((current) => ({ ...current, ...changed }))} />
        )}
      </div>
      <aside className="flex max-w-115 min-w-0 flex-[1_1_360px] flex-col gap-3.5">
        <ReceiptPaper school={school}>{face}</ReceiptPaper>
        {panel}
      </aside>
      {pending?.stage.kind === 'saved' && (
        <Dialog open={viewing} onOpenChange={setViewing}>
          <DialogContent className="max-w-160">
            <DialogTitle>{words.receipt.title(pending.stage.receipt.snapshot.receiptNo)}</DialogTitle>
            <DialogDescription>{words.receipt.description}</DialogDescription>
            <SavedReceipt snapshot={pending.stage.receipt.snapshot} />
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
