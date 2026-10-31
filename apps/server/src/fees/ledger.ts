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

function total(rows: readonly { amountPaisa: bigint }[]): bigint {
  return rows.reduce((sum, row) => sum + row.amountPaisa, 0n)
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
// money counts until the payment is voided.
export async function readLedger(db: Db, studentId: string): Promise<StudentLedger> {
  const rows = await db.feeDue.findMany({
    where: { studentId },
    include: {
      feeHead: { select: { name: true, kind: true } },
      allocations: { where: { payment: { voidRecord: { is: null } } }, select: { amountPaisa: true } },
      fines: {
        include: { allocations: { where: { payment: { voidRecord: { is: null } } }, select: { amountPaisa: true } } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      },
    },
    orderBy: [{ dueDate: 'asc' }, { billDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
  })

  const feeDues: FeeDueBalance[] = []
  const fines: FineBalance[] = []
  for (const row of rows) {
    const paid = total(row.allocations)
    const owed = row.status !== 'cancelled'
    feeDues.push({
      id: row.id,
      headName: row.feeHead.name,
      monthly: row.feeHead.kind === 'monthly',
      periodLabel: row.periodLabel,
      billDate: fromDbDate(row.billDate),
      dueDate: fromDbDate(row.dueDate),
      amount: row.amountPaisa,
      discount: row.discountPaisa,
      paid,
      owed,
      remaining: remainingOf(`Fee due ${row.id}`, row.amountPaisa - row.discountPaisa, paid, owed),
    })
    for (const fine of row.fines) {
      const finePaid = total(fine.allocations)
      const fineOwed = fine.waivedAt === null
      fines.push({
        id: fine.id,
        feeDueId: row.id,
        reason: fine.reason,
        headName: row.feeHead.name,
        periodLabel: row.periodLabel,
        amount: fine.amountPaisa,
        paid: finePaid,
        owed: fineOwed,
        remaining: remainingOf(`Fine ${fine.id}`, fine.amountPaisa, finePaid, fineOwed),
      })
    }
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
