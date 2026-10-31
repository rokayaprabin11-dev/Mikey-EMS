import type { Prisma } from '@mikey/db'
import {
  type AdDate,
  adToBs,
  CASH_DENOMINATIONS,
  type DayClose,
  type DayCloseCreate,
  dayCloseCreateSchema,
  type DayCloseSnapshot,
  dayCloseSnapshotSchema,
  type DayClosesResponse,
  type DayCloseStatus,
  formatBsDate,
  formatBsDateLong,
  formatRupees,
  kathmanduDate,
  PAYMENT_METHODS,
  schoolProfileSchema,
  toPaisaNumber,
} from '@mikey/shared'

import { writeAudit } from '../audit.ts'
import type { RequestContext, SessionContext } from '../auth/sessions.ts'
import { fromDbDate, toDbDate } from '../dates.ts'
import type { AppDeps, Db } from '../deps.ts'
import { fail } from '../errors.ts'
import { renderDayCloseSummary } from '../pdf/day-close.ts'
import { readSetting } from '../settings.ts'
import { balanceOf, lockAccount, onlyAccount } from './accounts.ts'

const closedBy = { closedBy: { select: { fullName: true } } } satisfies Prisma.DayCloseInclude

function toDayClose(row: Prisma.DayCloseGetPayload<{ include: typeof closedBy }>): DayClose {
  return {
    id: row.id,
    closeDate: fromDbDate(row.closeDate),
    expectedCash: toPaisaNumber(row.expectedCashPaisa),
    countedCash: toPaisaNumber(row.countedCashPaisa),
    difference: toPaisaNumber(row.differencePaisa),
    counts: dayCloseCreateSchema.shape.counts.parse(row.denominations),
    note: row.note,
    closedBy: row.closedBy.fullName,
    closedAt: row.closedAt.toISOString(),
  }
}

// What the cashbook says the drawer should hold at the end of a day, and the close if there is one.
export async function dayCloseStatus(db: Db, date: AdDate): Promise<DayCloseStatus> {
  const cash = await onlyAccount(db, 'cash')
  const expected = await balanceOf(db, cash.id, { through: date })
  const row = await db.dayClose.findUnique({ where: { closeDate: toDbDate(date) }, include: closedBy })
  return { date, expectedCash: toPaisaNumber(expected), dayClose: row === null ? null : toDayClose(row) }
}

export async function listDayCloses(db: Db): Promise<DayClosesResponse> {
  const rows = await db.dayClose.findMany({ include: closedBy, orderBy: { closeDate: 'desc' } })
  return { dayCloses: rows.map(toDayClose) }
}

interface CloseInput extends RequestContext {
  session: SessionContext
  body: DayCloseCreate
}

type DayTotals = Pick<DayCloseSnapshot, 'feesByMethod' | 'incomeByCategory' | 'expensesByCategory' | 'voids'>

function present<T>(values: readonly (T | null)[]): T[] {
  return values.filter((value) => value !== null)
}

function byName<T extends { name: string }>(items: T[]): T[] {
  return items.sort((a, b) => a.name.localeCompare(b.name))
}

async function categoryTotals(
  rows: { categoryId: string; _sum: { amountPaisa: bigint | null } }[],
  names: (ids: string[]) => Promise<{ id: string; name: string }[]>,
): Promise<DayTotals['incomeByCategory']> {
  const nameOf = new Map((await names(rows.map((row) => row.categoryId))).map((category) => [category.id, category.name]))
  return byName(
    rows.map((row) => ({ name: nameOf.get(row.categoryId) ?? '', amount: toPaisaNumber(row._sum.amountPaisa ?? 0n) })),
  )
}

// The voids whose reversing entries are dated this day, in the order they were made.
async function voidsOn(tx: Db, day: Date): Promise<DayTotals['voids']> {
  const entries = await tx.accountEntry.findMany({
    where: { entryDate: day, voidId: { not: null } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { accountId: true, amountPaisa: true, voidId: true },
  })
  const voidIds = entries.flatMap((entry) => (entry.voidId === null ? [] : [entry.voidId]))
  const voids = await tx.voidRecord.findMany({
    where: { id: { in: voidIds } },
    select: { id: true, reason: true, paymentId: true, incomeId: true, expenseId: true, voidedById: true },
  })
  const receipts = await tx.receipt.findMany({
    where: { paymentId: { in: present(voids.map((row) => row.paymentId)) } },
    select: { paymentId: true, receiptNo: true },
  })
  const incomes = await tx.income.findMany({
    where: { id: { in: present(voids.map((row) => row.incomeId)) } },
    select: { id: true, description: true },
  })
  const expenses = await tx.expense.findMany({
    where: { id: { in: present(voids.map((row) => row.expenseId)) } },
    select: { id: true, description: true },
  })
  const people = await tx.user.findMany({ where: { id: { in: voids.map((row) => row.voidedById) } }, select: { id: true, fullName: true } })
  const accounts = await tx.account.findMany({ where: { id: { in: entries.map((entry) => entry.accountId) } }, select: { id: true, name: true } })

  const voidById = new Map(voids.map((row) => [row.id, row]))
  const receiptNoOf = new Map(receipts.map((row) => [row.paymentId, row.receiptNo]))
  const descriptionOf = new Map([...incomes, ...expenses].map((row) => [row.id, row.description]))
  const nameOf = new Map(people.map((row) => [row.id, row.fullName]))
  const accountNameOf = new Map(accounts.map((row) => [row.id, row.name]))
  return entries.map((entry) => {
    const voided = entry.voidId === null ? undefined : voidById.get(entry.voidId)
    if (voided === undefined) {
      throw new Error(`Account entry for void ${entry.voidId ?? ''} has no void.`)
    }
    let target: DayTotals['voids'][number]['target']
    if (voided.paymentId !== null) {
      target = { type: 'payment', receiptNo: receiptNoOf.get(voided.paymentId) ?? '' }
    } else if (voided.incomeId !== null) {
      target = { type: 'income', description: descriptionOf.get(voided.incomeId) ?? '' }
    } else if (voided.expenseId !== null) {
      target = { type: 'expense', description: descriptionOf.get(voided.expenseId) ?? '' }
    } else {
      throw new Error(`Void ${voided.id} points at nothing.`)
    }
    return {
      target,
      accountName: accountNameOf.get(entry.accountId) ?? '',
      amount: toPaisaNumber(entry.amountPaisa),
      reason: voided.reason,
      voidedBy: nameOf.get(voided.voidedById) ?? '',
    }
  })
}

// The day's money as the summary prints it. It runs inside the close, so it reads one table per
// query, one query after another (CLAUDE.md).
async function dayTotals(tx: Db, date: AdDate): Promise<DayTotals> {
  const day = toDbDate(date)
  const fees = await tx.payment.groupBy({
    by: ['method'],
    where: { paidDate: day },
    _count: { _all: true },
    _sum: { amountPaisa: true },
  })
  const incomes = await tx.income.groupBy({ by: ['categoryId'], where: { incomeDate: day }, _sum: { amountPaisa: true } })
  const expenses = await tx.expense.groupBy({ by: ['categoryId'], where: { expenseDate: day }, _sum: { amountPaisa: true } })
  const categoryNames = (table: 'income' | 'expense') => (ids: string[]) =>
    table === 'income'
      ? tx.incomeCategory.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
      : tx.expenseCategory.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
  const incomeByCategory = await categoryTotals(incomes, categoryNames('income'))
  const expensesByCategory = await categoryTotals(expenses, categoryNames('expense'))
  const feesByMethod = PAYMENT_METHODS.flatMap((method) => {
    const row = fees.find((item) => item.method === method)
    return row === undefined
      ? []
      : [{ method, receiptCount: row._count._all, amount: toPaisaNumber(row._sum.amountPaisa ?? 0n) }]
  })
  return { feesByMethod, incomeByCategory, expensesByCategory, voids: await voidsOn(tx, day) }
}

// Records today's drawer count against the cashbook. Closing a day does not lock it (Q14).
export async function closeDay(deps: AppDeps, input: CloseInput): Promise<DayClose> {
  const { body, session, now, computer } = input
  const today = kathmanduDate(now)
  const id = await deps.db.$transaction(async (tx) => {
    // Holding the cash account keeps money from leaving the drawer while it is counted.
    const cash = await lockAccount(tx, (await onlyAccount(tx, 'cash')).id)
    if ((await tx.dayClose.count({ where: { closeDate: toDbDate(today) } })) > 0) {
      throw fail('DAY_ALREADY_CLOSED')
    }
    const expected = await balanceOf(tx, cash.id, { through: today })
    if (expected < 0n) {
      throw fail('CASH_BELOW_ZERO', { short: toPaisaNumber(-expected) })
    }
    const school = await readSetting(tx, 'school.profile', schoolProfileSchema)
    if (school === null) {
      throw fail('SCHOOL_NOT_SET_UP', { making: 'day-close summaries' })
    }
    const counted = body.counts.reduce((sum, item) => sum + BigInt(item.note) * 100n * BigInt(item.count), 0n)
    const note = body.note === undefined || body.note === '' ? null : body.note
    const counts = CASH_DENOMINATIONS.flatMap((denomination) => body.counts.filter((item) => item.note === denomination))
    const snapshot = dayCloseSnapshotSchema.parse({
      version: 1,
      school: { name: school.name, address: school.address, phone: school.phone, pan: school.pan, logo: null },
      date: { ad: today, bs: formatBsDate(adToBs(today)) },
      closedAt: now.toISOString(),
      closedBy: session.user.fullName,
      counts,
      countedCash: toPaisaNumber(counted),
      expectedCash: toPaisaNumber(expected),
      difference: toPaisaNumber(counted - expected),
      note,
      ...(await dayTotals(tx, today)),
    })
    const row = await tx.dayClose.create({
      data: {
        closeDate: toDbDate(today),
        expectedCashPaisa: expected,
        countedCashPaisa: counted,
        differencePaisa: counted - expected,
        denominations: counts,
        note,
        closedById: session.user.id,
        closedAt: now,
        snapshot,
      },
    })
    await writeAudit(tx, {
      at: now,
      userId: session.user.id,
      computer,
      action: 'accounts.day_closed',
      area: 'Accounts',
      recordType: 'day_close',
      recordId: row.id,
      summary: `${session.user.fullName} closed ${formatBsDateLong(adToBs(today))}: counted ${formatRupees(toPaisaNumber(counted))}, cashbook ${formatRupees(toPaisaNumber(expected))}`,
      after: { expectedCash: toPaisaNumber(expected), countedCash: toPaisaNumber(counted), note },
    })
    return row.id
  })
  return toDayClose(await deps.db.dayClose.findUniqueOrThrow({ where: { id }, include: closedBy }))
}

interface PrintInput extends RequestContext {
  session: SessionContext
  params: { date: AdDate }
}

// The first print of a day's summary is the original and every later one a copy. Prints of one
// summary happen one at a time (each locks the close), so copies are numbered one after another.
export function printDayCloseSummary(deps: AppDeps, input: PrintInput): Promise<Buffer> {
  const { params, session, now, computer } = input
  return deps.db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM day_closes WHERE close_date = ${params.date}::date FOR UPDATE`
    const row = await tx.dayClose.findUnique({ where: { closeDate: toDbDate(params.date) }, select: { id: true, snapshot: true } })
    if (row === null) {
      throw fail('NOT_FOUND', { what: 'dayClose' })
    }
    const prints = await tx.dayClosePrint.findMany({ where: { dayCloseId: row.id }, select: { printNo: true } })
    const printNo = Math.max(0, ...prints.map((print) => print.printNo)) + 1
    const snapshot = dayCloseSnapshotSchema.parse(row.snapshot)
    const pdf = await renderDayCloseSummary(snapshot, { printedAt: now, computer, copy: printNo === 1 ? null : printNo })
    await tx.dayClosePrint.create({
      data: { dayCloseId: row.id, printNo, computer, printedById: session.user.id, printedAt: now },
    })
    return pdf
  })
}
