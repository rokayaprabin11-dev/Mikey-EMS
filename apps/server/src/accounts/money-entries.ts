import type { Prisma } from '@mikey/db'
import {
  bsMonthToAdRange,
  type CategoriesResponse,
  formatRupees,
  kathmanduDate,
  type MoneyEntry,
  type MoneyEntryCreate,
  type MoneyEntryListResponse,
  parseBsDate,
  toPaisaNumber,
} from '@mikey/shared'

import { writeAudit } from '../audit.ts'
import type { RequestContext, SessionContext } from '../auth/sessions.ts'
import { fromDbDate, toDbDate } from '../dates.ts'
import type { AppDeps, Db } from '../deps.ts'
import { fail } from '../errors.ts'
import { recordStatus } from '../record-status.ts'
import { balanceOf, lockAccount } from './accounts.ts'

// Income and expenses are the same kind of record kept in two tables.
export type EntryKind = 'income' | 'expense'

const entryDetails = {
  category: { select: { id: true, name: true } },
  account: { select: { id: true, name: true, kind: true } },
  enteredBy: { select: { fullName: true } },
  voidRecord: { select: { id: true } },
  voidRequests: { where: { status: 'pending' }, select: { id: true } },
} satisfies Prisma.IncomeInclude & Prisma.ExpenseInclude

// What income and expense rows have in common once loaded with entryDetails.
interface EntryRow {
  id: string
  description: string
  voucherNo: string | null
  amountPaisa: bigint
  createdAt: Date
  category: { id: string; name: string }
  account: { id: string; name: string; kind: 'cash' | 'bank' }
  enteredBy: { fullName: string }
  voidRecord: { id: string } | null
  voidRequests: { id: string }[]
}

function toMoneyEntry(row: EntryRow, date: Date): MoneyEntry {
  return {
    id: row.id,
    entryDate: fromDbDate(date),
    description: row.description,
    category: row.category,
    account: row.account,
    voucherNo: row.voucherNo,
    amount: toPaisaNumber(row.amountPaisa),
    status: recordStatus(row),
    enteredBy: row.enteredBy.fullName,
    createdAt: row.createdAt.toISOString(),
  }
}

async function readMoneyEntry(db: Db, kind: EntryKind, id: string): Promise<MoneyEntry> {
  if (kind === 'expense') {
    const row = await db.expense.findUniqueOrThrow({ where: { id }, include: entryDetails })
    return toMoneyEntry(row, row.expenseDate)
  }
  const row = await db.income.findUniqueOrThrow({ where: { id }, include: entryDetails })
  return toMoneyEntry(row, row.incomeDate)
}

interface CreateInput extends RequestContext {
  session: SessionContext
  body: MoneyEntryCreate
}

export async function createMoneyEntry(deps: AppDeps, kind: EntryKind, input: CreateInput): Promise<MoneyEntry> {
  const { body, session, now, computer } = input
  const id = await deps.db.$transaction(async (tx) => {
    const account = await lockAccount(tx, body.accountId)
    // A repeat of the same request returns what the first one saved.
    const earlier =
      kind === 'expense'
        ? await tx.expense.findUnique({ where: { idempotencyKey: body.idempotencyKey }, select: { id: true } })
        : await tx.income.findUnique({ where: { idempotencyKey: body.idempotencyKey }, select: { id: true } })
    if (earlier !== null) {
      return earlier.id
    }
    const category =
      kind === 'expense'
        ? await tx.expenseCategory.findUnique({ where: { id: body.categoryId } })
        : await tx.incomeCategory.findUnique({ where: { id: body.categoryId } })
    if (category === null) {
      throw fail('NOT_FOUND', { what: 'category' })
    }
    if (!category.isActive) {
      throw fail('CATEGORY_INACTIVE')
    }
    const amount = BigInt(body.amount)
    if (kind === 'expense' && account.kind === 'cash') {
      const cash = await balanceOf(tx, account.id)
      if (amount > cash) {
        throw fail('INSUFFICIENT_CASH', { balance: toPaisaNumber(cash), doing: 'expense' })
      }
    }
    // Until Q14 is decided, every income and expense is dated today (D19).
    const date = toDbDate(kathmanduDate(now))
    const record = {
      idempotencyKey: body.idempotencyKey,
      categoryId: category.id,
      accountId: account.id,
      amountPaisa: amount,
      description: body.description,
      voucherNo: body.voucherNo ?? null,
      enteredById: session.user.id,
      createdAt: now,
    }
    const row =
      kind === 'expense'
        ? await tx.expense.create({ data: { ...record, expenseDate: date } })
        : await tx.income.create({ data: { ...record, incomeDate: date } })
    await tx.accountEntry.create({
      data: {
        accountId: account.id,
        entryDate: date,
        direction: kind === 'expense' ? 'out' : 'in',
        amountPaisa: amount,
        ...(kind === 'expense' ? { expenseId: row.id } : { incomeId: row.id }),
        createdAt: now,
      },
    })
    await writeAudit(tx, {
      at: now,
      userId: session.user.id,
      computer,
      action: kind === 'expense' ? 'accounts.expense_entered' : 'accounts.income_entered',
      area: 'Accounts',
      recordType: kind,
      recordId: row.id,
      summary: `${session.user.fullName} entered the ${kind} "${body.description}" (${formatRupees(body.amount)}, ${account.name})`,
      after: { categoryId: category.id, accountId: account.id, amountPaisa: body.amount, voucherNo: body.voucherNo ?? null },
    })
    return row.id
  })
  return readMoneyEntry(deps.db, kind, id)
}

// One BS month's entries, newest first, with the total and the amount per category. Voided
// entries are listed but left out of both.
export async function listMoneyEntries(db: Db, kind: EntryKind, bsMonth: string): Promise<MoneyEntryListResponse> {
  const { year, month } = parseBsDate(`${bsMonth}-01`)
  const range = bsMonthToAdRange(year, month)
  const dates = { gte: toDbDate(range.from), lte: toDbDate(range.to) }
  const entries =
    kind === 'expense'
      ? (
          await db.expense.findMany({
            where: { expenseDate: dates },
            include: entryDetails,
            orderBy: [{ expenseDate: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
          })
        ).map((row) => toMoneyEntry(row, row.expenseDate))
      : (
          await db.income.findMany({
            where: { incomeDate: dates },
            include: entryDetails,
            orderBy: [{ incomeDate: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
          })
        ).map((row) => toMoneyEntry(row, row.incomeDate))

  const counted = entries.filter((entry) => entry.status !== 'voided')
  const byCategory = new Map<string, { categoryId: string; name: string; amount: number }>()
  for (const entry of counted) {
    const sum = byCategory.get(entry.category.id) ?? { categoryId: entry.category.id, name: entry.category.name, amount: 0 }
    sum.amount += entry.amount
    byCategory.set(entry.category.id, sum)
  }
  return {
    entries,
    total: counted.reduce((sum, entry) => sum + entry.amount, 0),
    byCategory: [...byCategory.values()].toSorted((a, b) => b.amount - a.amount),
  }
}

export async function listCategories(db: Db, kind: EntryKind): Promise<CategoriesResponse> {
  const rows =
    kind === 'expense'
      ? await db.expenseCategory.findMany({ orderBy: { name: 'asc' } })
      : await db.incomeCategory.findMany({ orderBy: { name: 'asc' } })
  return { categories: rows.map((row) => ({ id: row.id, name: row.name, isActive: row.isActive })) }
}
