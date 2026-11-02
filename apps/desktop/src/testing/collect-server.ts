import {
  bsToAd,
  buildReceiptSnapshot,
  type CollectPaymentRequest,
  type DueItem,
  errorMessage,
  ERRORS,
  type PaymentPreviewRequest,
  type Receipt,
  type ReceiptLineInput,
  receiptMoney,
  type ReceiptPreview,
} from '@mikey/shared'

import type { ServerReply, ServerRequest } from '../../electron/bridge.ts'
import { computer1WithSignIn, json, NO_REPLY } from './fake-bridge.ts'

export const BIBEK = {
  id: '9f9a5ed9-0d5c-4b8a-9c9f-8e1d3c5a7b98',
  fullName: 'Bibek Lama',
  className: 'Class 7',
  sectionName: 'A',
  code: 'MEMS-2076-0098',
  rollNo: 17,
  status: 'active',
  guardianName: 'Pasang Lama',
  guardianPhone: '98600 12884',
}

const ASHWIN_DUE = '2a2b8c1c-3a8f-4ebd-8f2c-1b4a6f8d0e21'
const KARTIK_DUE = '3b3c9d2d-4b9a-4fce-9a3d-2c5b7a9e1f32'
export const LATE_FINE = '4c4dae3e-5cab-4adf-8b4e-3d6c8bae2a43'

// Bibek owes what is left of Ashwin's tuition after a part payment, its late fine, and Kartik's
// tuition less a scholarship. Today is 12 Kartik 2083, so Ashwin's is overdue.
export const BIBEK_DUES: readonly DueItem[] = [
  {
    kind: 'fee',
    feeDueId: ASHWIN_DUE,
    headName: 'Monthly tuition',
    periodLabel: 'Ashwin 2083',
    dueDate: bsToAd({ year: 2083, month: 6, day: 15 }),
    amount: 368_000,
    discount: 0,
    paid: 200_000,
    remaining: 168_000,
  },
  {
    kind: 'fine',
    fineId: LATE_FINE,
    feeDueId: ASHWIN_DUE,
    headName: 'Monthly tuition',
    periodLabel: 'Ashwin 2083',
    reason: 'Late fine, Ashwin 2083',
    amount: 10_000,
    remaining: 10_000,
  },
  {
    kind: 'fee',
    feeDueId: KARTIK_DUE,
    headName: 'Monthly tuition',
    periodLabel: 'Kartik 2083',
    dueDate: bsToAd({ year: 2083, month: 7, day: 15 }),
    amount: 400_000,
    discount: 32_000,
    paid: 0,
    remaining: 368_000,
  },
]

const BILL_DATES: Record<string, string> = {
  [ASHWIN_DUE]: bsToAd({ year: 2083, month: 6, day: 1 }),
  [KARTIK_DUE]: bsToAd({ year: 2083, month: 7, day: 1 }),
}

type Allocation = CollectPaymentRequest['allocations'][number]

function matches(due: DueItem, allocation: Allocation): boolean {
  return allocation.kind === 'fee' ? due.kind === 'fee' && due.feeDueId === allocation.feeDueId : due.kind === 'fine' && due.fineId === allocation.fineId
}

function labelOf(due: DueItem): string {
  return due.kind === 'fee' ? `${due.headName}, ${due.periodLabel}` : due.reason
}

function refusal(code: keyof typeof ERRORS, message: string): ServerReply {
  return json(ERRORS[code].status, { error: { code, message, details: {} } })
}

export const SAVED_AT = '2026-10-29T05:13:00.000Z'

// A Computer 1 that takes Bibek Lama's fees as the real one does, with the shared receipt code:
// a payment is saved once per idempotency key, the original prints once per print key, and paid
// dues leave the list. `fees` lets a test lose an answer or have the other counter pay a due.
export function computer1TakingFees() {
  const fees = {
    dues: [...BIBEK_DUES],
    // Saved payments by idempotency key.
    saved: new Map<string, Receipt>(),
    // The print key each original was printed with, by payment.
    prints: new Map<string, string>(),
    previews: [] as ReceiptPreview[],
    // The next payment is saved, but its answer never comes back.
    loseNextReply: false,
    // The next original is recorded, but its answer never comes back.
    loseNextPrintReply: false,
    // The next payment is refused with this answer.
    refuseNext: null as ServerReply | null,
    // The other counter pays a due in full.
    paidElsewhere(dueId: string): void {
      fees.dues = fees.dues.filter((due) => (due.kind === 'fee' ? due.feeDueId : due.fineId) !== dueId)
    },
  }

  const total = (): number => fees.dues.reduce((sum, due) => sum + due.remaining, 0)

  // The receipt lines a payment would have, or the refusal the server would give.
  function plan(allocations: readonly Allocation[]): { lines: ReceiptLineInput[]; discount: number } | ServerReply {
    const lines: ReceiptLineInput[] = []
    let discount = 0
    for (const allocation of allocations) {
      const due = fees.dues.find((item) => matches(item, allocation))
      if (due === undefined) {
        const known = BIBEK_DUES.find((item) => matches(item, allocation))
        return known === undefined
          ? refusal('NOT_FOUND', errorMessage('NOT_FOUND', { what: 'due' }))
          : refusal('DUE_ALREADY_PAID', errorMessage('DUE_ALREADY_PAID', { item: labelOf(known) }))
      }
      if (allocation.amount > due.remaining) {
        const params = { item: labelOf(due), amount: allocation.amount, remaining: due.remaining }
        return refusal('AMOUNT_EXCEEDS_DUE', errorMessage('AMOUNT_EXCEEDS_DUE', params))
      }
      if (due.kind === 'fee') {
        lines.push({
          kind: 'fee',
          headName: due.headName,
          monthly: true,
          periodLabel: due.periodLabel,
          billDate: BILL_DATES[due.feeDueId] ?? due.dueDate,
          amount: allocation.amount,
          wasPartPaid: due.paid > 0,
          clearsDue: allocation.amount === due.remaining,
        })
        discount += due.discount
      } else {
        lines.push({ kind: 'fine', reason: due.reason, amount: allocation.amount })
      }
    }
    return { lines, discount }
  }

  function preview(body: PaymentPreviewRequest): ServerReply {
    const planned = plan(body.allocations)
    if ('reached' in planned) {
      return planned
    }
    const money = receiptMoney({ lines: planned.lines, duesBefore: total(), discount: planned.discount })
    fees.previews.push(money)
    return json(200, money)
  }

  function collect(body: CollectPaymentRequest): ServerReply {
    const earlier = fees.saved.get(body.idempotencyKey)
    if (earlier !== undefined) {
      return json(200, { receipt: earlier, alreadySaved: true })
    }
    if (fees.refuseNext !== null) {
      const refused = fees.refuseNext
      fees.refuseNext = null
      return refused
    }
    const planned = plan(body.allocations)
    if ('reached' in planned) {
      return planned
    }
    const count = fees.saved.size
    const snapshot = buildReceiptSnapshot({
      school: { name: 'Mikey English Medium School', address: 'Banepa, Kavrepalanchok', phone: '011-660000', pan: '600000000' },
      receiptNo: `2083/84-${String(1285 + count).padStart(6, '0')}`,
      sessionName: '2083',
      issuedAt: new Date(Date.parse(SAVED_AT) + count * 60_000),
      paidDate: '2026-10-29',
      student: {
        code: BIBEK.code,
        fullName: BIBEK.fullName,
        className: BIBEK.className,
        sectionName: BIBEK.sectionName,
        rollNo: BIBEK.rollNo,
        guardianName: BIBEK.guardianName,
      },
      lines: planned.lines,
      duesBefore: total(),
      discount: planned.discount,
      method: body.method,
      reference: body.reference ?? null,
      receivedBy: 'Bikash Thapa',
    })
    const receipt: Receipt = { paymentId: crypto.randomUUID(), status: 'posted', printCount: 0, snapshot }
    fees.saved.set(body.idempotencyKey, receipt)
    fees.dues = fees.dues.flatMap((due) => {
      const allocation = body.allocations.find((item) => matches(due, item))
      if (allocation === undefined) {
        return [due]
      }
      const remaining = due.remaining - allocation.amount
      if (remaining === 0) {
        return []
      }
      return due.kind === 'fee' ? [{ ...due, paid: due.paid + allocation.amount, remaining }] : [{ ...due, remaining }]
    })
    if (fees.loseNextReply) {
      fees.loseNextReply = false
      return NO_REPLY
    }
    return json(200, { receipt, alreadySaved: false })
  }

  function printOriginal(paymentId: string, printKey: string): ServerReply {
    const printedWith = fees.prints.get(paymentId)
    if (printedWith !== undefined && printedWith !== printKey) {
      return refusal('ALREADY_PRINTED', errorMessage('ALREADY_PRINTED'))
    }
    fees.prints.set(paymentId, printKey)
    if (fees.loseNextPrintReply) {
      fees.loseNextPrintReply = false
      return NO_REPLY
    }
    return { reached: true, status: 200, contentType: 'application/pdf', body: new TextEncoder().encode(`%PDF-1.7 receipt ${paymentId}`) }
  }

  function route(request: ServerRequest): ServerReply | null {
    const { method, path } = request
    if (method === 'GET' && path.startsWith('/students?')) {
      const q = new URLSearchParams(path.split('?')[1]).get('q') ?? ''
      const found = 'bibek lama 98600 12884'.includes(q.toLowerCase())
      return found ? json(200, { students: [{ ...BIBEK, outstanding: total() }] }) : null
    }
    if (method === 'GET' && path === `/students/${BIBEK.id}/dues`) {
      return json(200, { studentId: BIBEK.id, items: fees.dues, total: total() })
    }
    if (method === 'GET' && path === `/students/${BIBEK.id}/fees`) {
      return json(200, {
        student: { ...BIBEK, outstanding: total(), guardianRelationship: 'Father' },
        dues: fees.dues,
        paidThisSession: { sessionName: '2083', since: '2026-04-14', amount: 200_000, receiptCount: 1 },
        payments: [],
      })
    }
    const body: unknown = JSON.parse(request.body ?? 'null')
    if (method === 'POST' && path === '/payments/preview') {
      return preview(body as PaymentPreviewRequest)
    }
    if (method === 'POST' && path === '/payments') {
      return collect(body as CollectPaymentRequest)
    }
    const print = /^\/payments\/([0-9a-f-]+)\/print$/.exec(path)
    if (method === 'POST' && print?.[1] !== undefined) {
      return printOriginal(print[1], (body as { printKey: string }).printKey)
    }
    return null
  }

  const server = computer1WithSignIn(undefined, route)
  return { ...server, fees }
}

// The requests sent to save a payment, as Computer 1 received them.
export function paymentsSent(sent: readonly ServerRequest[]): CollectPaymentRequest[] {
  return sent.filter((request) => request.method === 'POST' && request.path === '/payments').map((request) => JSON.parse(request.body ?? '') as CollectPaymentRequest)
}
