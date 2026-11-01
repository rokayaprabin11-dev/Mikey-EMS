import type { Prisma } from '@mikey/db'
import {
  type AdDate,
  adToBs,
  bsMonthToAdRange,
  type FinanceDashboard,
  formatBsDate,
  kathmanduDate,
  PAYMENT_METHODS,
  receiptSnapshotSchema,
  type SchoolDashboard,
  toPaisaNumber,
} from '@mikey/shared'

import { balanceOf, listAccounts, onlyAccount } from '../accounts/accounts.ts'
import type { SessionContext } from '../auth/sessions.ts'
import { fromDbDate, toDbDate } from '../dates.ts'
import type { Db } from '../deps.ts'
import { owedItems, readLedger } from '../fees/ledger.ts'
import { outstandingByStudent } from '../fees/outstanding.ts'
import { listedPayment, toPaymentListItem } from '../fees/payments.ts'
import { listVoidRequests } from '../fees/voids.ts'
import { recordStatus } from '../record-status.ts'
import { studentRefs } from '../students/lookup.ts'

// Everything here is worked out from the recorded rows each time it is asked for; no total is
// stored. Money taken counts the receipts that still stand, as the Payments list does: a void of
// an earlier receipt shows in the fee collection report on the day of the void.
const standing = { voidRecord: { is: null } } satisfies Prisma.PaymentWhereInput

const LATEST_RECEIPTS = 5
const LARGEST_DUES = 4

function bsMonthKey(year: number, month: number): string {
  return formatBsDate({ year, month, day: 1 }).slice(0, 7)
}

function bsMonthOf(ad: AdDate): string {
  const { year, month } = adToBs(ad)
  return bsMonthKey(year, month)
}

function monthStart(ad: AdDate): AdDate {
  const { year, month } = adToBs(ad)
  return bsMonthToAdRange(year, month).from
}

function sumOf(value: bigint | null): number {
  return toPaisaNumber(value ?? 0n)
}

async function collection(db: Db, where: Prisma.PaymentWhereInput) {
  const rows = await db.payment.groupBy({
    by: ['method'],
    where: { ...where, ...standing },
    _count: { _all: true },
    _sum: { amountPaisa: true },
  })
  const byMethod = PAYMENT_METHODS.flatMap((method) => {
    const row = rows.find((item) => item.method === method)
    return row === undefined ? [] : [{ method, receiptCount: row._count._all, amount: sumOf(row._sum.amountPaisa) }]
  })
  return {
    amount: byMethod.reduce((sum, item) => sum + item.amount, 0),
    receiptCount: byMethod.reduce((sum, item) => sum + item.receiptCount, 0),
    byMethod,
  }
}

// Money taken on each day from `from` to `to` that had any.
async function collectionByDay(db: Db, from: AdDate, to: AdDate) {
  const rows = await db.payment.groupBy({
    by: ['paidDate'],
    where: { paidDate: { gte: toDbDate(from), lte: toDbDate(to) }, ...standing },
    _sum: { amountPaisa: true },
    orderBy: { paidDate: 'asc' },
  })
  return rows.map((row) => ({ date: fromDbDate(row.paidDate), amount: sumOf(row._sum.amountPaisa) }))
}

async function moneyToday(db: Db, today: AdDate, voidRequests: FinanceDashboard['voidRequests']) {
  const day = toDbDate(today)
  const thisMonth = { gte: toDbDate(monthStart(today)), lte: day }

  const collected = await db.payment.aggregate({ where: { paidDate: thisMonth, ...standing }, _sum: { amountPaisa: true } })
  const owed = await outstandingByStudent(db)
  const spent = await db.expense.aggregate({
    where: { expenseDate: day, voidRecord: { is: null } },
    _sum: { amountPaisa: true },
    _count: { _all: true },
  })
  const expenses = await db.expense.findMany({
    where: { expenseDate: day },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      description: true,
      amountPaisa: true,
      category: { select: { name: true } },
      account: { select: { kind: true } },
      voidRecord: { select: { id: true } },
      voidRequests: { where: { status: 'pending' }, select: { id: true } },
    },
  })
  const cash = await onlyAccount(db, 'cash')
  const lastClose = await db.dayClose.findFirst({
    where: { closeDate: { lte: day } },
    orderBy: { closeDate: 'desc' },
    select: { closeDate: true, closedAt: true, differencePaisa: true, closedBy: { select: { fullName: true } } },
  })
  return {
    date: today,
    collectedThisMonth: { amount: sumOf(collected._sum.amountPaisa), bsMonth: bsMonthOf(today), upTo: today },
    feesOutstanding: {
      amount: toPaisaNumber([...owed.values()].reduce((sum, amount) => sum + amount, 0n)),
      studentCount: owed.size,
    },
    spentToday: { amount: sumOf(spent._sum.amountPaisa), entryCount: spent._count._all },
    accounts: (await listAccounts(db)).accounts,
    todaysExpenses: expenses.map((expense) => ({
      id: expense.id,
      description: expense.description,
      categoryName: expense.category.name,
      accountKind: expense.account.kind,
      status: recordStatus(expense),
      amount: toPaisaNumber(expense.amountPaisa),
    })),
    dayClose: {
      expectedCash: toPaisaNumber(await balanceOf(db, cash.id, { through: today })),
      last:
        lastClose === null
          ? null
          : {
              date: fromDbDate(lastClose.closeDate),
              closedAt: lastClose.closedAt.toISOString(),
              closedBy: lastClose.closedBy.fullName,
              difference: toPaisaNumber(lastClose.differencePaisa),
            },
    },
    voidRequests,
  }
}

// The students who owe the most, with what they owe item by item.
async function largestDues(db: Db): Promise<FinanceDashboard['largestDues']> {
  const owed = [...(await outstandingByStudent(db)).entries()]
    .sort(([idA, a], [idB, b]) => (a === b ? idA.localeCompare(idB) : a > b ? -1 : 1))
    .slice(0, LARGEST_DUES)
  const refs = await studentRefs(
    db,
    owed.map(([id]) => id),
  )
  const result: FinanceDashboard['largestDues'] = []
  for (const [studentId, amount] of owed) {
    const student = refs.get(studentId)
    if (student !== undefined) {
      const items = owedItems(await readLedger(db, studentId)).map((item) => ({
        kind: item.kind,
        headName: item.headName,
        periodLabel: item.periodLabel,
        partPaid: item.kind === 'fee' && item.paid > 0,
      }))
      result.push({ student, amount: toPaisaNumber(amount), items })
    }
  }
  return result
}

export async function financeDashboard(db: Db, session: SessionContext, now: Date): Promise<FinanceDashboard> {
  const today = kathmanduDate(now)
  const mine = { takenById: session.user.id }
  const voidRequests = await listVoidRequests(db, { requestedById: session.user.id, status: 'pending' }, 'desc')
  const latest = await db.payment.findMany({
    where: mine,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: LATEST_RECEIPTS,
    select: listedPayment,
  })
  const day = toDbDate(today)
  return {
    ...(await moneyToday(db, today, voidRequests)),
    collectedToday: {
      ...(await collection(db, { paidDate: day })),
      receiptCountByYou: await db.payment.count({ where: { paidDate: day, ...mine, ...standing } }),
    },
    latestReceipts: latest.map(toPaymentListItem),
    collectionByDay: await collectionByDay(db, monthStart(today), today),
    largestDues: await largestDues(db),
  }
}

// Each BS month of the current session up to this one, with the money taken in it.
async function collectionByMonth(db: Db, today: AdDate): Promise<SchoolDashboard['collectionByMonth']> {
  const session = await db.academicSession.findFirst({ where: { isCurrent: true }, select: { startDate: true } })
  if (session === null) {
    return []
  }
  const start = fromDbDate(session.startDate)
  const totals = new Map<string, number>()
  let { year, month } = adToBs(start)
  for (let key = bsMonthKey(year, month); key <= bsMonthOf(today); key = bsMonthKey(year, month)) {
    totals.set(key, 0)
    if (month === 12) {
      year += 1
      month = 1
    } else {
      month += 1
    }
  }
  for (const day of await collectionByDay(db, start, today)) {
    const month = bsMonthOf(day.date)
    totals.set(month, (totals.get(month) ?? 0) + day.amount)
  }
  return [...totals.entries()].map(([bsMonth, amount]) => ({ bsMonth, amount }))
}

export async function schoolDashboard(db: Db, now: Date): Promise<SchoolDashboard> {
  const today = kathmanduDate(now)
  const day = toDbDate(today)
  const thisMonth = { gte: toDbDate(monthStart(today)), lte: day }
  const voidRequests = await listVoidRequests(db, { status: 'pending' }, 'asc')
  const lastToday = await db.payment.findFirst({
    where: { paidDate: day, ...standing },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { createdAt: true },
  })
  const income = await db.income.aggregate({ where: { incomeDate: thisMonth, voidRecord: { is: null } }, _sum: { amountPaisa: true } })
  const expenses = await db.expense.aggregate({ where: { expenseDate: thisMonth, voidRecord: { is: null } }, _sum: { amountPaisa: true } })
  const latest = await db.payment.findMany({
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: LATEST_RECEIPTS,
    select: listedPayment,
  })
  return {
    ...(await moneyToday(db, today, voidRequests)),
    collectedToday: { ...(await collection(db, { paidDate: day })), lastAt: lastToday?.createdAt.toISOString() ?? null },
    incomeThisMonth: sumOf(income._sum.amountPaisa),
    expensesThisMonth: sumOf(expenses._sum.amountPaisa),
    collectionByMonth: await collectionByMonth(db, today),
    latestReceipts: latest.map((row) => ({
      ...toPaymentListItem(row),
      lines: receiptSnapshotSchema.parse(row.receipt?.snapshot).lines,
    })),
  }
}
