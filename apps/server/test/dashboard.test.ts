import { randomUUID } from 'node:crypto'

import type { User } from '@mikey/db'
import {
  accountsResponseSchema,
  bookResponseSchema,
  bsToAd,
  collectPaymentResponseSchema,
  dayCloseStatusSchema,
  financeDashboardSchema,
  schoolDashboardSchema,
  voidRequestSchema,
} from '@mikey/shared'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { readLedger } from '../src/fees/ledger.ts'
import { outstandingByStudent } from '../src/fees/outstanding.ts'
import {
  addDue,
  allowComputer,
  createStudent,
  createUser,
  ensureSchool,
  errorOf,
  type School,
  signIn,
  startTestServer,
  type TestServer,
} from './support.ts'

// The Accountant works on Computer 2; the Super Admin on Computer 1.
const COUNTER = '192.168.1.84'

// A server whose clock is on 5 Magh 2083, 10:00 AM.
const TODAY = bsToAd({ year: 2083, month: 10, day: 5 })
const YESTERDAY = bsToAd({ year: 2083, month: 10, day: 4 })
const server: TestServer = startTestServer()
server.advanceMinutes((new Date(`${TODAY}T10:00:00+05:45`).getTime() - server.now().getTime()) / 60_000)

let school: School
let admin: User
let accountant: User
let accountantToken: string
let adminToken: string
let expenseCategoryId: string

beforeAll(async () => {
  school = await ensureSchool(server.db)
  admin = await createUser(server.db, 'super_admin')
  accountant = await createUser(server.db, 'accountant')
  await allowComputer(server.db, COUNTER, admin)
  expenseCategoryId = (
    await server.db.expenseCategory.upsert({ where: { name: 'Stationery and teaching' }, create: { name: 'Stationery and teaching' }, update: {} })
  ).id
})

beforeEach(async () => {
  accountantToken = await signIn(server, accountant, COUNTER)
  adminToken = await signIn(server, admin)
})

afterAll(() => server.close())

const asAccountant = () => ({ token: accountantToken, ip: COUNTER })
const asAdmin = () => ({ token: adminToken })

function get(as: { token: string; ip?: string }, path: string) {
  return server.call({ method: 'GET', path, ...as })
}

function post(as: { token: string; ip?: string }, path: string, body: object, on = server) {
  return on.call({ method: 'POST', path, ...as, body })
}

// A Magh tuition due of Rs. 3,550 for a new student, and a payment of `rupees` towards it.
async function collect(as: { token: string; ip?: string }, rupees: number, method: object = { method: 'cash' }, on = server) {
  const student = await createStudent(on.db, school, 'Kiran Dashboard')
  const due = await addDue(on.db, school, student.id, { month: 10, rupees: 3550 })
  on.advanceMinutes(1)
  const response = await post(
    as,
    '/payments',
    {
    idempotencyKey: randomUUID(),
    studentId: student.id,
    ...method,
      allocations: [{ kind: 'fee', feeDueId: due.id, amount: rupees * 100 }],
    },
    on,
  )
  expect(response.statusCode, response.body).toBe(200)
  return collectPaymentResponseSchema.parse(response.json()).receipt
}

async function financeDashboard() {
  const response = await get(asAccountant(), '/dashboard/finance')
  expect(response.statusCode, response.body).toBe(200)
  return financeDashboardSchema.parse(response.json())
}

describe('the dashboards', () => {
  let fonepay: Awaited<ReturnType<typeof collect>>

  it("shows the Accountant today's collection by method, what is owed, cash and bank, waiting voids and the last close", async () => {
    await collect(asAccountant(), 3550)
    fonepay = await collect(asAccountant(), 2000, { method: 'fonepay', reference: 'FP-7781' })
    await collect(asAdmin(), 1000)
    server.advanceMinutes(1)
    const expense = await post(asAccountant(), '/expenses', {
      idempotencyKey: randomUUID(),
      categoryId: expenseCategoryId,
      accountId: school.cashId,
      amount: 45_000,
      description: 'Chalk and dusters',
    })
    expect(expense.statusCode, expense.body).toBe(200)
    const asked = await post(asAccountant(), '/void-requests', {
      target: { type: 'payment', id: fonepay.paymentId },
      reason: 'wrong_method',
      details: 'Paid in cash, not Fonepay.',
    })
    const request = voidRequestSchema.parse(asked.json())

    const dashboard = await financeDashboard()
    expect(dashboard.date).toBe(TODAY)
    // A waiting request changes no money, so the Fonepay receipt still counts.
    expect(dashboard.collectedToday).toEqual({
      amount: 655_000,
      receiptCount: 3,
      receiptCountByYou: 2,
      byMethod: [
        { method: 'cash', receiptCount: 2, amount: 455_000 },
        { method: 'fonepay', receiptCount: 1, amount: 200_000 },
      ],
    })
    expect(dashboard.voidsToday).toEqual({ amount: 0, receiptCount: 0 })
    expect(dashboard.collectedThisMonth).toEqual({ amount: 655_000, bsMonth: '2083-10', upTo: TODAY })
    expect(dashboard.collectionByDay).toEqual([{ date: TODAY, amount: 655_000 }])
    expect(dashboard.spentToday).toEqual({ amount: 45_000, entryCount: 1 })
    expect(dashboard.todaysExpenses).toMatchObject([
      { description: 'Chalk and dusters', categoryName: 'Stationery and teaching', accountKind: 'cash', status: 'posted', amount: 45_000 },
    ])
    expect(dashboard.voidRequests.map((item) => item.id)).toEqual([request.id])
    expect(dashboard.latestReceipts[0]).toMatchObject({ receiptNo: fonepay.snapshot.receiptNo, status: 'void_requested' })

    const { accounts } = accountsResponseSchema.parse((await get(asAccountant(), '/accounts')).json())
    expect(dashboard.accounts).toEqual(accounts)
    const status = dayCloseStatusSchema.parse((await get(asAccountant(), `/day-closes/${TODAY}`)).json())
    expect(dashboard.dayClose.expectedCash).toBe(status.expectedCash)

    // What is owed is worked out from every student's dues, as their own ledgers say.
    const owed = await outstandingByStudent(server.db)
    expect(dashboard.feesOutstanding).toEqual({
      amount: Number([...owed.values()].reduce((sum, amount) => sum + amount, 0n)),
      studentCount: owed.size,
    })
    const amounts = dashboard.largestDues.map((item) => item.amount)
    expect(amounts).toEqual([...amounts].sort((a, b) => b - a))
    for (const item of dashboard.largestDues) {
      expect(BigInt(item.amount)).toBe((await readLedger(server.db, item.student.id)).outstanding)
    }
  })

  it("takes a voided receipt out of today's collection, and shows today's close once the day is closed", async () => {
    const approved = await post(asAdmin(), `/void-requests/${(await financeDashboard()).voidRequests[0]?.id ?? ''}/approve`, {})
    expect(approved.statusCode, approved.body).toBe(200)
    server.advanceMinutes(1)
    const closed = await post(asAccountant(), '/day-closes', { counts: [{ note: 100, count: 1 }] })
    expect(closed.statusCode, closed.body).toBe(200)

    const dashboard = await financeDashboard()
    expect(dashboard.collectedToday).toMatchObject({ amount: 455_000, receiptCount: 2, receiptCountByYou: 1 })
    expect(dashboard.collectedToday.byMethod).toEqual([{ method: 'cash', receiptCount: 2, amount: 455_000 }])
    expect(dashboard.voidRequests).toEqual([])
    expect(dashboard.dayClose.last).toMatchObject({ date: TODAY, closedBy: 'Test Accountant' })
  })

  it("gives the Super Admin this month's income and expenses, each month of the session, the latest receipts and every waiting request", async () => {
    const receipt = await collect(asAccountant(), 1200)
    // A monthly head that is not marked as tuition stays out of the tuition share.
    const transport = await server.db.feeHead.create({ data: { name: 'Transport', kind: 'monthly' } })
    const rider = await createStudent(server.db, school, 'Kiran Transport')
    await server.db.feeDue.create({
      data: {
        studentId: rider.id,
        sessionId: school.sessionId,
        feeHeadId: transport.id,
        periodLabel: 'Magh 2083',
        billDate: new Date(`${bsToAd({ year: 2083, month: 10, day: 1 })}T00:00:00.000Z`),
        dueDate: new Date(`${bsToAd({ year: 2083, month: 10, day: 15 })}T00:00:00.000Z`),
        amountPaisa: 150_000n,
      },
    })
    const response = await get(asAdmin(), '/dashboard/school')
    expect(response.statusCode, response.body).toBe(200)
    const dashboard = schoolDashboardSchema.parse(response.json())

    expect(dashboard.collectedToday).toMatchObject({ amount: 575_000, receiptCount: 3, lastAt: server.now().toISOString() })
    expect(dashboard.expensesThisMonth).toBe(45_000)
    expect(dashboard.incomeThisMonth).toBe(0)
    expect(dashboard.collectionByMonth.map((item) => item.bsMonth)).toEqual([
      '2083-01', '2083-02', '2083-03', '2083-04', '2083-05', '2083-06', '2083-07', '2083-08', '2083-09', '2083-10',
    ])
    expect(dashboard.collectionByMonth.at(-1)).toEqual({ bsMonth: '2083-10', amount: 575_000 })
    // Four Magh tuition dues of Rs. 3,550. Rs. 3,550, 1,000 and 1,200 were paid towards them; the
    // Fonepay Rs. 2,000 was voided, so it does not count. 5,750 of 14,200 is 40% (rounded down).
    expect(dashboard.tuitionThisMonth).toEqual({ billed: 1_420_000, collected: 575_000, percent: 40 })
    expect(dashboard.latestReceipts[0]).toMatchObject({ receiptNo: receipt.snapshot.receiptNo, takenBy: 'Test Accountant' })
    expect(dashboard.latestReceipts[0]?.lines).toEqual(receipt.snapshot.lines)
    const pending = await server.db.voidRequest.count({ where: { status: 'pending' } })
    expect(dashboard.voidRequests).toHaveLength(pending)
  })

  it("shows receipts from earlier days voided today, so collected less voids is today's fee movement", async () => {
    // A receipt taken yesterday on a second server, working in this file's database.
    const earlierDay = startTestServer()
    try {
      earlierDay.advanceMinutes((new Date(`${YESTERDAY}T10:00:00+05:45`).getTime() - earlierDay.now().getTime()) / 60_000)
      const earlier = await collect({ token: await signIn(earlierDay, accountant, COUNTER), ip: COUNTER }, 2500, { method: 'cash' }, earlierDay)
      server.advanceMinutes(1)
      const voided = await post(asAdmin(), '/voids', {
        target: { type: 'payment', id: earlier.paymentId },
        reason: 'wrong_student',
        details: 'Wrong student.',
      })
      expect(voided.statusCode, voided.body).toBe(200)

      const dashboard = await financeDashboard()
      expect(dashboard.voidsToday).toEqual({ amount: 250_000, receiptCount: 1 })
      let movement = 0
      for (const accountId of [school.cashId, school.bankId]) {
        const book = bookResponseSchema.parse((await get(asAccountant(), `/accounts/${accountId}/book?date=${TODAY}`)).json())
        for (const entry of book.entries) {
          if (entry.source.type === 'payment') {
            movement += entry.amount
          } else if (entry.source.type === 'void' && entry.source.target.type === 'payment') {
            movement -= entry.amount
          }
        }
      }
      expect(dashboard.collectedToday.amount - dashboard.voidsToday.amount).toBe(movement)
    } finally {
      await earlierDay.close()
    }
  })

  it("does not show the Super Admin's dashboard to the Accountant", async () => {
    expect(errorOf(await get(asAccountant(), '/dashboard/school'))).toMatchObject({ status: 403, code: 'NO_PERMISSION' })
  })
})
