import type { Prisma } from '@mikey/db'
import { type AdDate, type BookEntry, type BookResponse, receiptSnapshotSchema, toPaisaNumber } from '@mikey/shared'

import { toDbDate } from '../dates.ts'
import type { Db } from '../deps.ts'
import { fail } from '../errors.ts'
import { balanceOf } from './accounts.ts'

const moneyEntry = {
  select: {
    id: true,
    description: true,
    voucherNo: true,
    category: { select: { name: true } },
    enteredBy: { select: { fullName: true } },
  },
} as const

const sources = {
  payment: { select: { id: true, receipt: { select: { snapshot: true } } } },
  income: moneyEntry,
  expense: moneyEntry,
  transfer: {
    select: { id: true, note: true, fromAccountId: true, fromAccount: { select: { name: true } }, toAccount: { select: { name: true } } },
  },
  voidRecord: {
    select: {
      id: true,
      reason: true,
      voidedBy: { select: { fullName: true } },
      payment: { select: { receipt: { select: { receiptNo: true } } } },
      income: { select: { description: true } },
      expense: { select: { description: true } },
    },
  },
} satisfies Prisma.AccountEntryInclude

type EntryRow = Prisma.AccountEntryGetPayload<{ include: typeof sources }>

function moneyEntryText(entry: NonNullable<EntryRow['income']>) {
  return {
    description: entry.description,
    categoryName: entry.category.name,
    voucherNo: entry.voucherNo,
    enteredBy: entry.enteredBy.fullName,
  }
}

// What each line of the book is, as the cashbook shows it. A void shows as its own reversing line.
function sourceOf(row: EntryRow, accountId: string): BookEntry['source'] {
  if (row.payment !== null) {
    const receipt = row.payment.receipt
    if (receipt === null) {
      throw new Error(`Payment ${row.payment.id} has no receipt.`)
    }
    const snapshot = receiptSnapshotSchema.parse(receipt.snapshot)
    return { type: 'payment', paymentId: row.payment.id, receiptNo: snapshot.receiptNo, studentName: snapshot.student.fullName }
  }
  if (row.income !== null) {
    return { type: 'income', incomeId: row.income.id, ...moneyEntryText(row.income) }
  }
  if (row.expense !== null) {
    return { type: 'expense', expenseId: row.expense.id, ...moneyEntryText(row.expense) }
  }
  if (row.transfer !== null) {
    const other = row.transfer.fromAccountId === accountId ? row.transfer.toAccount : row.transfer.fromAccount
    return { type: 'transfer', transferId: row.transfer.id, otherAccountName: other.name, note: row.transfer.note }
  }
  if (row.voidRecord !== null) {
    const voided = row.voidRecord
    const receiptNo = voided.payment?.receipt?.receiptNo
    let target: Extract<BookEntry['source'], { type: 'void' }>['target']
    if (receiptNo !== undefined) {
      target = { type: 'payment', receiptNo }
    } else if (voided.income !== null) {
      target = { type: 'income', description: voided.income.description }
    } else if (voided.expense !== null) {
      target = { type: 'expense', description: voided.expense.description }
    } else {
      throw new Error(`Void ${voided.id} points at nothing.`)
    }
    return { type: 'void', voidId: voided.id, target, reason: voided.reason, approvedBy: voided.voidedBy.fullName }
  }
  throw new Error(`Account entry ${row.id} has no source.`)
}

// One account's book for one day: the balance brought forward, every entry in the order it was
// made with the running balance, and the balance carried forward.
export async function accountBook(db: Db, accountId: string, date: AdDate): Promise<BookResponse> {
  const account = await db.account.findUnique({ where: { id: accountId }, select: { id: true, name: true, kind: true } })
  if (account === null) {
    throw fail('NOT_FOUND', { what: 'account' })
  }
  const opening = await balanceOf(db, accountId, { before: date })
  const closed =
    account.kind === 'cash'
      ? await db.dayClose.findUnique({ where: { closeDate: toDbDate(date) }, select: { closedAt: true } })
      : null
  const rows = await db.accountEntry.findMany({
    where: { accountId, entryDate: toDbDate(date) },
    include: sources,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })

  let balance = opening
  let moneyIn = 0n
  let moneyOut = 0n
  const entries = rows.map((row): BookEntry => {
    if (row.direction === 'in') {
      balance += row.amountPaisa
      moneyIn += row.amountPaisa
    } else {
      balance -= row.amountPaisa
      moneyOut += row.amountPaisa
    }
    return {
      id: row.id,
      at: row.createdAt.toISOString(),
      direction: row.direction,
      amount: toPaisaNumber(row.amountPaisa),
      balance: toPaisaNumber(balance),
      source: sourceOf(row, accountId),
    }
  })
  return {
    account,
    date,
    openingBalance: toPaisaNumber(opening),
    entries,
    totals: { moneyIn: toPaisaNumber(moneyIn), moneyOut: toPaisaNumber(moneyOut) },
    closingBalance: toPaisaNumber(balance),
    // Closing a day does not lock it (Q14), so the cashbook says what was entered after the count.
    dayClose:
      closed === null
        ? null
        : { closedAt: closed.closedAt.toISOString(), entriesAfter: rows.filter((row) => row.createdAt > closed.closedAt).length },
  }
}
