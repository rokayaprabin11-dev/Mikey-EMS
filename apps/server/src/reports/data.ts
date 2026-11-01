import {
  type AdDate,
  printEn,
  type Report,
  type ReportQuery,
  receiptSnapshotSchema,
  schoolProfileSchema,
  toPaisaNumber,
} from '@mikey/shared'

import type { SessionContext } from '../auth/sessions.ts'
import { fromDbDate, toDbDate } from '../dates.ts'
import type { Db } from '../deps.ts'
import { fail } from '../errors.ts'
import { owedByStudent } from '../fees/outstanding.ts'
import { readSetting } from '../settings.ts'
import { studentRefs } from '../students/lookup.ts'

type ReportOf<T extends Report['type']> = Extract<Report, { type: T }>
type Header = Report['header']

function dateRange(from: AdDate, to: AdDate) {
  return { gte: toDbDate(from), lte: toDbDate(to) }
}

function sum(amounts: readonly number[]): number {
  return amounts.reduce((total, amount) => total + amount, 0)
}

// Every receipt and every void of a receipt with its cash or bank entry dated in the period, in the
// order they were made, so the total is what the cashbook and bankbook show for fees.
async function feeCollection(db: Db, header: Header): Promise<ReportOf<'fee_collection'>> {
  const receipt = { select: { receipt: { select: { snapshot: true } } } } as const
  const entries = await db.accountEntry.findMany({
    where: {
      entryDate: dateRange(header.from, header.to),
      OR: [{ paymentId: { not: null } }, { voidRecord: { paymentId: { not: null } } }],
    },
    orderBy: [{ entryDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      entryDate: true,
      createdAt: true,
      amountPaisa: true,
      account: { select: { name: true } },
      payment: receipt,
      voidRecord: { select: { reason: true, voidedBy: { select: { fullName: true } }, payment: receipt } },
    },
  })
  const rows = entries.map((entry): ReportOf<'fee_collection'>['rows'][number] => {
    const voided = entry.voidRecord
    const stored = entry.payment?.receipt ?? voided?.payment?.receipt
    if (stored === undefined || stored === null) {
      throw new Error(`Account entry ${entry.id} is not for a receipt.`)
    }
    const snapshot = receiptSnapshotSchema.parse(stored.snapshot)
    return {
      kind: voided === null ? 'receipt' : 'void',
      date: fromDbDate(entry.entryDate),
      at: entry.createdAt.toISOString(),
      receiptNo: snapshot.receiptNo,
      studentName: snapshot.student.fullName,
      className: snapshot.student.className,
      sectionName: snapshot.student.sectionName,
      method: snapshot.method,
      accountName: entry.account.name,
      amount: toPaisaNumber(entry.amountPaisa),
      reason: voided?.reason ?? null,
      voidedBy: voided?.voidedBy.fullName ?? null,
    }
  })
  const received = sum(rows.filter((row) => row.kind === 'receipt').map((row) => row.amount))
  const voidedTotal = sum(rows.filter((row) => row.kind === 'void').map((row) => row.amount))
  return { type: 'fee_collection', header, rows, totals: { received, voided: voidedTotal, net: received - voidedTotal } }
}

// One row per class, in the school's class order, for the dues billed in the period.
async function dues(db: Db, header: Header): Promise<ReportOf<'dues'>> {
  const owed = await owedByStudent(db, { billed: { from: header.from, to: header.to } })
  const refs = await studentRefs(db, [...owed.keys()])
  const classes = await db.schoolClass.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], select: { name: true } })
  const order = [...classes.map((item) => item.name), printEn.reports.noClass]
  const byClass = new Map<string, ReportOf<'dues'>['rows'][number]>()
  for (const [studentId, { billed, outstanding }] of owed) {
    const className = refs.get(studentId)?.className ?? printEn.reports.noClass
    const row = byClass.get(className) ?? { className, studentsBilled: 0, studentsOwing: 0, billed: 0, paid: 0, outstanding: 0 }
    row.studentsBilled += 1
    row.studentsOwing += outstanding > 0n ? 1 : 0
    row.billed += toPaisaNumber(billed)
    row.paid += toPaisaNumber(billed - outstanding)
    row.outstanding += toPaisaNumber(outstanding)
    byClass.set(className, row)
  }
  const rows = [...byClass.values()].sort((a, b) => order.indexOf(a.className) - order.indexOf(b.className))
  const total = (key: 'studentsBilled' | 'studentsOwing' | 'billed' | 'paid' | 'outstanding') => sum(rows.map((row) => row[key]))
  return {
    type: 'dues',
    header,
    rows,
    totals: {
      studentsBilled: total('studentsBilled'),
      studentsOwing: total('studentsOwing'),
      billed: total('billed'),
      paid: total('paid'),
      outstanding: total('outstanding'),
    },
  }
}

// Every expense and every void of an expense with its entry dated in the period.
async function expenses(db: Db, header: Header): Promise<ReportOf<'expenses'>> {
  const expense = { select: { description: true, voucherNo: true, category: { select: { name: true } } } } as const
  const entries = await db.accountEntry.findMany({
    where: {
      entryDate: dateRange(header.from, header.to),
      OR: [{ expenseId: { not: null } }, { voidRecord: { expenseId: { not: null } } }],
    },
    orderBy: [{ entryDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      entryDate: true,
      createdAt: true,
      amountPaisa: true,
      account: { select: { name: true } },
      expense,
      voidRecord: { select: { reason: true, voidedBy: { select: { fullName: true } }, expense } },
    },
  })
  const rows = entries.map((entry): ReportOf<'expenses'>['rows'][number] => {
    const voided = entry.voidRecord
    const source = entry.expense ?? voided?.expense
    if (source === undefined || source === null) {
      throw new Error(`Account entry ${entry.id} is not for an expense.`)
    }
    return {
      kind: voided === null ? 'expense' : 'void',
      date: fromDbDate(entry.entryDate),
      at: entry.createdAt.toISOString(),
      categoryName: source.category.name,
      description: source.description,
      voucherNo: source.voucherNo,
      accountName: entry.account.name,
      amount: toPaisaNumber(entry.amountPaisa),
      reason: voided?.reason ?? null,
      voidedBy: voided?.voidedBy.fullName ?? null,
    }
  })
  const byName = new Map<string, { name: string; spent: number; voided: number }>()
  for (const row of rows) {
    const category = byName.get(row.categoryName) ?? { name: row.categoryName, spent: 0, voided: 0 }
    category[row.kind === 'expense' ? 'spent' : 'voided'] += row.amount
    byName.set(row.categoryName, category)
  }
  const byCategory = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
  const spent = sum(rows.filter((row) => row.kind === 'expense').map((row) => row.amount))
  const voidedTotal = sum(rows.filter((row) => row.kind === 'void').map((row) => row.amount))
  return { type: 'expenses', header, rows, byCategory, totals: { spent, voided: voidedTotal, net: spent - voidedTotal } }
}

async function dayCloses(db: Db, header: Header): Promise<ReportOf<'day_closes'>> {
  const closes = await db.dayClose.findMany({
    where: { closeDate: dateRange(header.from, header.to) },
    orderBy: { closeDate: 'asc' },
    select: {
      closeDate: true,
      closedAt: true,
      expectedCashPaisa: true,
      countedCashPaisa: true,
      differencePaisa: true,
      note: true,
      closedBy: { select: { fullName: true } },
    },
  })
  const rows = closes.map((close) => ({
    date: fromDbDate(close.closeDate),
    closedAt: close.closedAt.toISOString(),
    closedBy: close.closedBy.fullName,
    expectedCash: toPaisaNumber(close.expectedCashPaisa),
    countedCash: toPaisaNumber(close.countedCashPaisa),
    difference: toPaisaNumber(close.differencePaisa),
    note: close.note,
  }))
  return {
    type: 'day_closes',
    header,
    rows,
    totals: {
      short: sum(rows.map((row) => Math.max(0, -row.difference))),
      over: sum(rows.map((row) => Math.max(0, row.difference))),
    },
  }
}

export async function buildReport(db: Db, query: ReportQuery, session: SessionContext, now: Date): Promise<Report> {
  const school = await readSetting(db, 'school.profile', schoolProfileSchema)
  if (school === null) {
    throw fail('SCHOOL_NOT_SET_UP', { making: 'reports' })
  }
  const header = {
    schoolName: school.name,
    from: query.from,
    to: query.to,
    generatedAt: now.toISOString(),
    generatedBy: session.user.fullName,
  }
  switch (query.type) {
    case 'fee_collection':
      return feeCollection(db, header)
    case 'dues':
      return dues(db, header)
    case 'expenses':
      return expenses(db, header)
    case 'day_closes':
      return dayCloses(db, header)
  }
}
