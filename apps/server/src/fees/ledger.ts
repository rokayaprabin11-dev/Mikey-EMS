import { type AdDate, type DueItem, toPaisaNumber } from '@mikey/shared'

import { fromDbDate } from '../dates.ts'
import type { Db } from '../deps.ts'

export interface FeeDueBalance {
  id: string
  headName: string
  monthly: boolean
  periodLabel: string
  billDate: AdDate
  dueDate: AdDate
  amount: bigint
  discount: bigint
  paid: bigint
  owed: boolean
  remaining: bigint
}

export interface FineBalance {
  id: string
  feeDueId: string
  reason: string
  headName: string
  periodLabel: string
  amount: bigint
  paid: bigint
  owed: boolean
  remaining: bigint
}

export interface StudentLedger {
  feeDues: FeeDueBalance[]
  fines: FineBalance[]
  outstanding: bigint
}

// A cancelled due or a waived fine is not owed. Overpayment is never taken, so a negative
// remainder means the records are wrong, and the server says so rather than hide it.
function remainingOf(what: string, owes: bigint, paid: bigint, owed: boolean): bigint {
  if (!owed) {
    return 0n
  }
  const remaining = owes - paid
  if (remaining < 0n) {
    throw new Error(`${what} has been paid more than it owes.`)
  }
  return remaining
}

// What a student owes, from their dues, fines and the money taken against them. A payment's
// money counts until the payment is voided. This runs inside the payment transaction, so it reads
// one table per query, one query after another (CLAUDE.md).
export async function readLedger(db: Db, studentId: string): Promise<StudentLedger> {
  const dueRows = await db.feeDue.findMany({
    where: { studentId },
    orderBy: [{ dueDate: 'asc' }, { billDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
  })
  const dueIds = dueRows.map((row) => row.id)
  const heads = await db.feeHead.findMany({
    where: { id: { in: [...new Set(dueRows.map((row) => row.feeHeadId))] } },
    select: { id: true, name: true, kind: true },
  })
  const fineRows = await db.fine.findMany({
    where: { feeDueId: { in: dueIds } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
  const takenRows = await db.paymentAllocation.groupBy({
    by: ['feeDueId', 'fineId'],
    where: {
      OR: [{ feeDueId: { in: dueIds } }, { fineId: { in: fineRows.map((row) => row.id) } }],
      payment: { voidRecord: { is: null } },
    },
    _sum: { amountPaisa: true },
  })

  const headById = new Map(heads.map((head) => [head.id, head]))
  const taken = new Map<string, bigint>()
  for (const row of takenRows) {
    const target = row.feeDueId ?? row.fineId
    if (target !== null) {
      taken.set(target, row._sum.amountPaisa ?? 0n)
    }
  }

  const feeDues: FeeDueBalance[] = []
  const dueById = new Map<string, FeeDueBalance>()
  for (const row of dueRows) {
    const head = headById.get(row.feeHeadId)
    if (head === undefined) {
      throw new Error(`Fee due ${row.id} has no fee head.`)
    }
    const paid = taken.get(row.id) ?? 0n
    const owed = row.status !== 'cancelled'
    const due: FeeDueBalance = {
      id: row.id,
      headName: head.name,
      monthly: head.kind === 'monthly',
      periodLabel: row.periodLabel,
      billDate: fromDbDate(row.billDate),
      dueDate: fromDbDate(row.dueDate),
      amount: row.amountPaisa,
      discount: row.discountPaisa,
      paid,
      owed,
      remaining: remainingOf(`Fee due ${row.id}`, row.amountPaisa - row.discountPaisa, paid, owed),
    }
    feeDues.push(due)
    dueById.set(row.id, due)
  }

  const fines: FineBalance[] = []
  for (const row of fineRows) {
    const due = dueById.get(row.feeDueId)
    if (due === undefined) {
      throw new Error(`Fine ${row.id} has no fee due.`)
    }
    const paid = taken.get(row.id) ?? 0n
    const owed = row.waivedAt === null
    fines.push({
      id: row.id,
      feeDueId: row.feeDueId,
      reason: row.reason,
      headName: due.headName,
      periodLabel: due.periodLabel,
      amount: row.amountPaisa,
      paid,
      owed,
      remaining: remainingOf(`Fine ${row.id}`, row.amountPaisa, paid, owed),
    })
  }
  const outstanding = [...feeDues, ...fines].reduce((sum, item) => sum + item.remaining, 0n)
  return { feeDues, fines, outstanding }
}

// Oldest dues first, each fine straight after the due it belongs to.
export function owedItems(ledger: StudentLedger): DueItem[] {
  const items: DueItem[] = []
  for (const due of ledger.feeDues) {
    if (due.remaining > 0n) {
      items.push({
        kind: 'fee',
        feeDueId: due.id,
        headName: due.headName,
        periodLabel: due.periodLabel,
        dueDate: due.dueDate,
        amount: toPaisaNumber(due.amount),
        discount: toPaisaNumber(due.discount),
        paid: toPaisaNumber(due.paid),
        remaining: toPaisaNumber(due.remaining),
      })
    }
    for (const fine of ledger.fines) {
      if (fine.feeDueId === due.id && fine.remaining > 0n) {
        items.push({
          kind: 'fine',
          fineId: fine.id,
          feeDueId: due.id,
          headName: fine.headName,
          periodLabel: fine.periodLabel,
          reason: fine.reason,
          amount: toPaisaNumber(fine.amount),
          remaining: toPaisaNumber(fine.remaining),
        })
      }
    }
  }
  return items
}
