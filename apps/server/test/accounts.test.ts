import { randomUUID } from 'node:crypto'

import type { User } from '@mikey/db'
import {
  accountsResponseSchema,
  bookResponseSchema,
  bsToAd,
  categoriesResponseSchema,
  collectPaymentResponseSchema,
  dayCloseSchema,
  dayCloseSnapshotSchema,
  dayClosesResponseSchema,
  dayCloseStatusSchema,
  formatKathmanduTime,
  formatReceiptAmount,
  moneyEntryListResponseSchema,
  moneyEntrySchema,
  printEn,
  transferSchema,
  voidRequestSchema,
} from '@mikey/shared'
import PDFDocument from 'pdfkit'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

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
const COUNTER = '192.168.1.82'

const server: TestServer = startTestServer()
let school: School
let admin: User
let accountant: User
const categories = { utilities: '', stationery: '', retired: '', interest: '' }

interface Caller {
  on: TestServer
  token: string
  ip?: string
}

let asAccountant: Caller
let asAdmin: Caller

beforeAll(async () => {
  school = await ensureSchool(server.db)
  admin = await createUser(server.db, 'super_admin')
  accountant = await createUser(server.db, 'accountant')
  await allowComputer(server.db, COUNTER, admin)
  const expense = (name: string, isActive = true) =>
    server.db.expenseCategory.upsert({ where: { name }, create: { name, isActive }, update: {} })
  categories.utilities = (await expense('Utilities')).id
  categories.stationery = (await expense('Stationery and teaching')).id
  categories.retired = (await expense('Old category', false)).id
  categories.interest = (await server.db.incomeCategory.upsert({ where: { name: 'Bank interest' }, create: { name: 'Bank interest' }, update: {} })).id
})

beforeEach(async () => {
  asAccountant = { on: server, token: await signIn(server, accountant, COUNTER), ip: COUNTER }
  asAdmin = { on: server, token: await signIn(server, admin) }
})

afterAll(() => server.close())

function post(as: Caller, path: string, body?: object) {
  return as.on.call({ method: 'POST', path, token: as.token, ip: as.ip, body })
}

function get(as: Caller, path: string) {
  return as.on.call({ method: 'GET', path, token: as.token, ip: as.ip })
}

function entry(categoryId: string, accountId: string, rupees: number, description = 'Whiteboard markers and chalk') {
  return { idempotencyKey: randomUUID(), categoryId, accountId, amount: rupees * 100, description, voucherNo: 'V-214' }
}

async function saved(as: Caller, path: '/expenses' | '/incomes', body: object) {
  const response = await post(as, path, body)
  expect(response.statusCode, response.body).toBe(200)
  return moneyEntrySchema.parse(response.json())
}

async function balance(as: Caller, accountId: string): Promise<number> {
  const { accounts } = accountsResponseSchema.parse((await get(as, '/accounts')).json())
  const account = accounts.find((item) => item.id === accountId)
  if (account === undefined) {
    throw new Error(`Account ${accountId} is not listed.`)
  }
  return account.balance
}

// Cash comes in as income, so a test that spends cash never depends on what earlier tests left.
async function addCash(as: Caller, rupees: number) {
  await saved(as, '/incomes', entry(categories.interest, school.cashId, rupees, 'Cash brought in for the test'))
}

async function approveVoid(target: { type: 'payment' | 'income' | 'expense'; id: string }, requester: Caller, approver: Caller) {
  const asked = await post(requester, '/void-requests', { target, reason: 'wrong_amount', details: 'Typed the wrong amount.' })
  expect(asked.statusCode, asked.body).toBe(200)
  const request = voidRequestSchema.parse(asked.json())
  const approved = await post(approver, `/void-requests/${request.id}/approve`, {})
  expect(approved.statusCode, approved.body).toBe(200)
}

// A second server whose clock is on a BS day that no other test uses.
async function onDay(month: number, day: number, year = 2083) {
  const other = startTestServer()
  const date = bsToAd({ year, month, day })
  other.advanceMinutes((new Date(`${date}T10:00:00+05:45`).getTime() - other.now().getTime()) / 60_000)
  return {
    other,
    date,
    accountant: { on: other, token: await signIn(other, accountant, COUNTER), ip: COUNTER } satisfies Caller,
    admin: { on: other, token: await signIn(other, admin) } satisfies Caller,
  }
}

describe('categories', () => {
  it('lists the income and expense categories, including ones no longer used', async () => {
    const expense = categoriesResponseSchema.parse((await get(asAccountant, '/expense-categories')).json())
    expect(expense.categories).toEqual(
      expect.arrayContaining([
        { id: categories.utilities, name: 'Utilities', isActive: true },
        { id: categories.retired, name: 'Old category', isActive: false },
      ]),
    )
    const income = categoriesResponseSchema.parse((await get(asAccountant, '/income-categories')).json())
    expect(income.categories).toContainEqual({ id: categories.interest, name: 'Bank interest', isActive: true })
  })
})

describe('income and expenses', () => {
  it('saves an expense dated today, with one cash entry and an audit row', async () => {
    await addCash(asAccountant, 5000)
    const before = await balance(asAccountant, school.cashId)

    const expense = await saved(asAccountant, '/expenses', entry(categories.stationery, school.cashId, 1450))
    expect(expense).toMatchObject({
      entryDate: '2026-10-31',
      description: 'Whiteboard markers and chalk',
      category: { id: categories.stationery, name: 'Stationery and teaching' },
      account: { id: school.cashId, name: 'Cash in hand', kind: 'cash' },
      voucherNo: 'V-214',
      amount: 145_000,
      status: 'posted',
      enteredBy: 'Test Accountant',
    })
    expect(await server.db.accountEntry.findMany({ where: { expenseId: expense.id } })).toMatchObject([
      { accountId: school.cashId, direction: 'out', amountPaisa: 145_000n, entryDate: new Date('2026-10-31T00:00:00.000Z') },
    ])
    expect(await balance(asAccountant, school.cashId)).toBe(before - 145_000)
    expect(await server.db.auditLog.findFirst({ where: { action: 'accounts.expense_entered', recordId: expense.id } })).toMatchObject({
      userId: accountant.id,
      computer: 2,
    })
  })

  it('refuses a cash expense larger than the cash in hand, and lets it be paid from the bank', async () => {
    const cash = await balance(asAccountant, school.cashId)
    const tooMuch = cash / 100 + 100

    expect(errorOf(await post(asAccountant, '/expenses', entry(categories.utilities, school.cashId, tooMuch)))).toEqual({
      status: 422,
      code: 'INSUFFICIENT_CASH',
      message: `Cash in hand is Rs. ${(cash / 100).toLocaleString('en-IN')}. Pay this from the bank, or lower the amount.`,
    })
    expect((await post(asAccountant, '/expenses', entry(categories.utilities, school.bankId, tooMuch))).statusCode).toBe(200)
  })

  it('returns the first entry for a repeated request and saves nothing new', async () => {
    const body = entry(categories.utilities, school.bankId, 2600, 'Internet, monthly')
    const first = await saved(asAccountant, '/expenses', body)
    const entries = await server.db.accountEntry.count()

    expect(await saved(asAccountant, '/expenses', body)).toEqual(first)
    expect(await server.db.accountEntry.count()).toBe(entries)
  })

  it('lets only one of two cash expenses through when together they would spend more than the cash', async () => {
    await addCash(asAccountant, 3000)
    const cash = await balance(asAccountant, school.cashId)

    const answers = await Promise.all([
      post(asAccountant, '/expenses', entry(categories.utilities, school.cashId, cash / 100)),
      post(asAccountant, '/expenses', entry(categories.utilities, school.cashId, cash / 100)),
    ])
    expect(answers.map((response) => response.statusCode).toSorted()).toEqual([200, 422])
    expect(await balance(asAccountant, school.cashId)).toBe(0)
  })

  it('refuses a category no longer used, an unknown category and an unknown account', async () => {
    expect(errorOf(await post(asAccountant, '/expenses', entry(categories.retired, school.bankId, 100)))).toMatchObject({
      status: 422,
      code: 'CATEGORY_INACTIVE',
    })
    expect(errorOf(await post(asAccountant, '/expenses', entry(randomUUID(), school.bankId, 100)))).toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    })
    expect(errorOf(await post(asAccountant, '/expenses', entry(categories.utilities, randomUUID(), 100)))).toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    })
  })

  it("lists a month's entries with the total and the amount per category, leaving voided ones out of both", async () => {
    const poush = await onDay(9, 3)
    try {
      await saved(poush.accountant, '/expenses', entry(categories.utilities, school.bankId, 5200, 'Electricity bill'))
      poush.other.advanceMinutes(1)
      const voided = await saved(poush.accountant, '/expenses', entry(categories.utilities, school.bankId, 2600, 'Typed twice'))
      poush.other.advanceMinutes(1)
      await saved(poush.accountant, '/expenses', entry(categories.stationery, school.bankId, 1450))
      await approveVoid({ type: 'expense', id: voided.id }, poush.accountant, poush.admin)
      await saved(poush.accountant, '/incomes', entry(categories.interest, school.bankId, 1240, 'Interest for Mangsir'))

      const expenses = moneyEntryListResponseSchema.parse((await get(poush.accountant, '/expenses?bsMonth=2083-09')).json())
      expect(expenses.entries.map((item) => [item.description, item.status])).toEqual([
        ['Whiteboard markers and chalk', 'posted'],
        ['Typed twice', 'voided'],
        ['Electricity bill', 'posted'],
      ])
      expect(expenses.total).toBe(665_000)
      expect(expenses.byCategory).toEqual([
        { categoryId: categories.utilities, name: 'Utilities', amount: 520_000 },
        { categoryId: categories.stationery, name: 'Stationery and teaching', amount: 145_000 },
      ])
      const incomes = moneyEntryListResponseSchema.parse((await get(poush.accountant, '/incomes?bsMonth=2083-09')).json())
      expect(incomes).toMatchObject({ total: 124_000, entries: [{ description: 'Interest for Mangsir' }] })
    } finally {
      await poush.other.close()
    }
  })
})

describe('transfers', () => {
  it('moves cash to the bank with one entry out of cash and one into the bank, dated today', async () => {
    await addCash(asAccountant, 2000)
    const cash = await balance(asAccountant, school.cashId)
    const bank = await balance(asAccountant, school.bankId)
    const body = {
      idempotencyKey: randomUUID(),
      fromAccountId: school.cashId,
      toAccountId: school.bankId,
      amount: 150_000,
      note: 'Afternoon deposit',
    }

    const response = await post(asAccountant, '/transfers', body)
    expect(response.statusCode, response.body).toBe(200)
    const transfer = transferSchema.parse(response.json())
    expect(transfer).toMatchObject({
      transferDate: '2026-10-31',
      from: { id: school.cashId, kind: 'cash' },
      to: { id: school.bankId, kind: 'bank' },
      amount: 150_000,
      note: 'Afternoon deposit',
      enteredBy: 'Test Accountant',
    })
    expect(await server.db.accountEntry.findMany({ where: { transferId: transfer.id }, orderBy: { direction: 'asc' } })).toMatchObject([
      { accountId: school.bankId, direction: 'in', amountPaisa: 150_000n },
      { accountId: school.cashId, direction: 'out', amountPaisa: 150_000n },
    ])
    expect(await balance(asAccountant, school.cashId)).toBe(cash - 150_000)
    expect(await balance(asAccountant, school.bankId)).toBe(bank + 150_000)

    const repeat = await post(asAccountant, '/transfers', body)
    expect(transferSchema.parse(repeat.json()).id).toBe(transfer.id)
    expect(await server.db.accountEntry.count({ where: { transferId: transfer.id } })).toBe(2)
  })

  it('refuses to move more cash than there is, or to move money into the same account', async () => {
    const cash = await balance(asAccountant, school.cashId)
    const tooMuch = { idempotencyKey: randomUUID(), fromAccountId: school.cashId, toAccountId: school.bankId, amount: cash + 100 }
    expect(errorOf(await post(asAccountant, '/transfers', tooMuch))).toMatchObject({ status: 422, code: 'INSUFFICIENT_CASH' })

    const sameAccount = { idempotencyKey: randomUUID(), fromAccountId: school.bankId, toAccountId: school.bankId, amount: 100 }
    expect(errorOf(await post(asAccountant, '/transfers', sameAccount))).toMatchObject({ status: 400, code: 'VALIDATION_FAILED' })
  })
})

describe('balances and the book', () => {
  it('shows a day with its opening balance, each entry and its running balance, and the closing balance', async () => {
    const mangsir = await onDay(8, 5)
    try {
      const { accountant: counter, admin: office, other, date } = mangsir
      const opening = dayCloseStatusSchema.parse((await get(counter, `/day-closes/${bsToAd({ year: 2083, month: 8, day: 4 })}`)).json())
        .expectedCash

      const student = await createStudent(other.db, school)
      const kartik = await addDue(other.db, school, student.id, { month: 7, rupees: 3550 })
      other.advanceMinutes(1)
      const paid = await post(counter, '/payments', {
        idempotencyKey: randomUUID(),
        studentId: student.id,
        method: 'cash',
        allocations: [{ kind: 'fee', feeDueId: kartik.id, amount: 355_000 }],
      })
      const { receipt } = collectPaymentResponseSchema.parse(paid.json())
      other.advanceMinutes(1)
      await saved(counter, '/expenses', entry(categories.stationery, school.cashId, 450))
      other.advanceMinutes(1)
      await saved(counter, '/incomes', entry(categories.interest, school.cashId, 1000, 'Old furniture sold'))
      other.advanceMinutes(1)
      await post(counter, '/transfers', { idempotencyKey: randomUUID(), fromAccountId: school.cashId, toAccountId: school.bankId, amount: 100_000 })
      other.advanceMinutes(1)
      await approveVoid({ type: 'payment', id: receipt.paymentId }, counter, office)

      const book = bookResponseSchema.parse((await get(counter, `/accounts/${school.cashId}/book?date=${date}`)).json())
      expect(book.openingBalance).toBe(opening)
      expect(book.entries.map((item) => [item.direction, item.amount, item.balance, item.source.type])).toEqual([
        ['in', 355_000, opening + 355_000, 'payment'],
        ['out', 45_000, opening + 310_000, 'expense'],
        ['in', 100_000, opening + 410_000, 'income'],
        ['out', 100_000, opening + 310_000, 'transfer'],
        ['out', 355_000, opening - 45_000, 'void'],
      ])
      expect(book.entries.map((item) => item.source)).toMatchObject([
        { type: 'payment', receiptNo: receipt.snapshot.receiptNo, studentName: 'Bibek Lama' },
        { type: 'expense', description: 'Whiteboard markers and chalk', categoryName: 'Stationery and teaching', voucherNo: 'V-214' },
        { type: 'income', description: 'Old furniture sold', categoryName: 'Bank interest', enteredBy: 'Test Accountant' },
        { type: 'transfer', otherAccountName: 'Current account', note: null },
        { type: 'void', target: { type: 'payment', receiptNo: receipt.snapshot.receiptNo }, reason: 'wrong_amount', approvedBy: 'Test Super Admin' },
      ])
      expect(book.totals).toEqual({ moneyIn: 455_000, moneyOut: 500_000 })
      expect(book.closingBalance).toBe(opening - 45_000)
      const status = dayCloseStatusSchema.parse((await get(counter, `/day-closes/${date}`)).json())
      expect(status.expectedCash).toBe(book.closingBalance)

      const bankBook = bookResponseSchema.parse((await get(counter, `/accounts/${school.bankId}/book?date=${date}`)).json())
      expect(bankBook.entries.map((item) => item.source)).toMatchObject([{ type: 'transfer', otherAccountName: 'Cash in hand' }])
    } finally {
      await mangsir.other.close()
    }
  })

  it('makes exactly one entry for each payment, income, expense and void, two for a transfer, and balances are their sum', async () => {
    const sources = await server.db.accountEntry.groupBy({
      by: ['paymentId', 'incomeId', 'expenseId', 'transferId', 'voidId'],
      _count: true,
    })
    for (const source of sources) {
      expect(source._count).toBe(source.transferId === null ? 1 : 2)
    }
    expect(await server.db.payment.count({ where: { accountEntries: { none: {} } } })).toBe(0)
    expect(await server.db.voidRecord.count({ where: { accountEntries: { none: {} } } })).toBe(0)

    const { accounts } = accountsResponseSchema.parse((await get(asAccountant, '/accounts')).json())
    for (const account of accounts) {
      const rows = await server.db.accountEntry.findMany({ where: { accountId: account.id }, select: { direction: true, amountPaisa: true } })
      const sum = rows.reduce((total, row) => total + (row.direction === 'in' ? row.amountPaisa : -row.amountPaisa), 0n)
      expect(account.balance).toBe(Number(sum))
    }
  })

  it('says when the account does not exist', async () => {
    expect(errorOf(await get(asAccountant, `/accounts/${randomUUID()}/book?date=2026-10-31`))).toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    })
  })
})

describe('day close', () => {
  it('records the count against the cashbook and refuses a second close of the same day', async () => {
    const mangsir = await onDay(8, 10)
    try {
      const { accountant: counter, date } = mangsir
      const before = dayCloseStatusSchema.parse((await get(counter, `/day-closes/${date}`)).json())
      expect(before.dayClose).toBeNull()

      const counts = [
        { note: 1000, count: 2 },
        { note: 100, count: 3 },
        { note: 2, count: 5 },
      ]
      const response = await post(counter, '/day-closes', { counts, note: 'Counted twice.' })
      expect(response.statusCode, response.body).toBe(200)
      const closed = dayCloseSchema.parse(response.json())
      expect(closed).toMatchObject({
        closeDate: date,
        expectedCash: before.expectedCash,
        countedCash: 231_000,
        difference: 231_000 - before.expectedCash,
        counts,
        note: 'Counted twice.',
        closedBy: 'Test Accountant',
      })
      expect(dayCloseStatusSchema.parse((await get(counter, `/day-closes/${date}`)).json()).dayClose).toEqual(closed)
      expect(errorOf(await post(counter, '/day-closes', { counts }))).toMatchObject({ status: 409, code: 'DAY_ALREADY_CLOSED' })
      const list = dayClosesResponseSchema.parse((await get(counter, '/day-closes')).json())
      expect(list.dayCloses.map((item) => item.id)).toContain(closed.id)
      expect(await mangsir.other.db.auditLog.findFirst({ where: { action: 'accounts.day_closed', recordId: closed.id } })).not.toBeNull()

      // Closing a day does not lock it.
      expect((await post(counter, '/expenses', entry(categories.utilities, school.bankId, 300))).statusCode).toBe(200)
    } finally {
      await mangsir.other.close()
    }
  })

  it('refuses a count of something that is not a note or coin, and a note counted twice', async () => {
    expect(errorOf(await post(asAccountant, '/day-closes', { counts: [{ note: 200, count: 1 }] }))).toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
    })
    const twice = [
      { note: 100, count: 1 },
      { note: 100, count: 2 },
    ]
    expect(errorOf(await post(asAccountant, '/day-closes', { counts: twice }))).toMatchObject({ status: 400, code: 'VALIDATION_FAILED' })
  })
})

// @types/pdfkit types the default export as a document rather than a class with a prototype.
const pdfDocument = (PDFDocument as unknown as { prototype: PDFKit.PDFDocument }).prototype

// Prints a day's summary and collects every piece of text drawn on it.
async function summary(as: Caller, date: string) {
  const text = vi.spyOn(pdfDocument, 'text')
  try {
    const response = await post(as, `/day-closes/${date}/print`)
    return { response, text: text.mock.calls.map(([value]) => String(value)).join('') }
  } finally {
    text.mockRestore()
  }
}

describe('the day-close summary', () => {
  it("prints the count, the day's money by method and by category, and the day's voids, from the snapshot saved at close", async () => {
    const day = await onDay(8, 15)
    try {
      const { accountant: counter, admin: office, other, date } = day
      const student = await createStudent(other.db, school, 'Sujata Tamang')
      const kartik = await addDue(other.db, school, student.id, { month: 7, rupees: 3550 })
      const mangsir = await addDue(other.db, school, student.id, { month: 8, rupees: 3550 })
      const pay = (feeDueId: string, method: object) =>
        post(counter, '/payments', {
          idempotencyKey: randomUUID(),
          studentId: student.id,
          ...method,
          allocations: [{ kind: 'fee', feeDueId, amount: 355_000 }],
        })
      const opening = dayCloseStatusSchema.parse(
        (await get(counter, `/day-closes/${bsToAd({ year: 2083, month: 8, day: 14 })}`)).json(),
      ).expectedCash
      expect((await pay(kartik.id, { method: 'cash' })).statusCode).toBe(200)
      other.advanceMinutes(1)
      const fonepay = collectPaymentResponseSchema.parse((await pay(mangsir.id, { method: 'fonepay', reference: 'FP-2231' })).json()).receipt
      other.advanceMinutes(1)
      await saved(counter, '/incomes', entry(categories.interest, school.cashId, 1000, 'Old furniture sold'))
      other.advanceMinutes(1)
      await saved(counter, '/expenses', entry(categories.stationery, school.cashId, 450))
      other.advanceMinutes(1)
      const typedTwice = await saved(counter, '/expenses', entry(categories.utilities, school.cashId, 260, 'Typed twice'))
      other.advanceMinutes(1)
      await approveVoid({ type: 'expense', id: typedTwice.id }, counter, office)
      other.advanceMinutes(1)
      await approveVoid({ type: 'payment', id: fonepay.paymentId }, counter, office)
      other.advanceMinutes(1)
      const moved = await post(counter, '/transfers', { idempotencyKey: randomUUID(), fromAccountId: school.cashId, toAccountId: school.bankId, amount: 50_000 })
      expect(moved.statusCode, moved.body).toBe(200)
      other.advanceMinutes(1)

      const { expectedCash } = dayCloseStatusSchema.parse((await get(counter, `/day-closes/${date}`)).json())
      const closed = await post(counter, '/day-closes', {
        counts: [
          { note: 100, count: 3 },
          { note: 1000, count: 1 },
        ],
        note: 'One note was torn.',
      })
      expect(closed.statusCode, closed.body).toBe(200)
      const row = await other.db.dayClose.findUniqueOrThrow({ where: { id: dayCloseSchema.parse(closed.json()).id } })
      expect(dayCloseSnapshotSchema.parse(row.snapshot)).toMatchObject({
        version: 1,
        date: { ad: date, bs: '2083-08-15' },
        closedBy: 'Test Accountant',
        counts: [
          { note: 1000, count: 1 },
          { note: 100, count: 3 },
        ],
        countedCash: 130_000,
        expectedCash,
        difference: 130_000 - expectedCash,
        note: 'One note was torn.',
        // In: the cash receipt, the income and the voided expense coming back. Out: the two
        // expenses and the money moved to the bank. The Fonepay receipt and its void are banked.
        cashBook: { opening, moneyIn: 481_000, moneyOut: 121_000, closing: opening + 360_000 },
        feesByMethod: [
          { method: 'cash', receiptCount: 1, gross: 355_000, voided: 0, net: 355_000 },
          { method: 'fonepay', receiptCount: 1, gross: 355_000, voided: 355_000, net: 0 },
        ],
        transfers: [{ fromAccount: 'Cash in hand', toAccount: 'Current account', amount: 50_000, note: null }],
        incomeByCategory: [{ name: 'Bank interest', amount: 100_000 }],
        expensesByCategory: [
          { name: 'Stationery and teaching', amount: 45_000 },
          { name: 'Utilities', amount: 26_000 },
        ],
        voids: [
          {
            target: { type: 'expense', description: 'Typed twice' },
            accountName: 'Cash in hand',
            amount: 26_000,
            reason: 'wrong_amount',
            voidedBy: 'Test Super Admin',
          },
          {
            target: { type: 'payment', receiptNo: fonepay.snapshot.receiptNo },
            accountName: 'Current account',
            amount: 355_000,
            reason: 'wrong_amount',
            voidedBy: 'Test Super Admin',
          },
        ],
      })
      expect(expectedCash).toBe(opening + 360_000)

      const original = await summary(counter, date)
      expect(original.response.statusCode).toBe(200)
      expect(original.response.headers['content-type']).toBe('application/pdf')
      for (const text of [
        'Mikey English Medium School',
        'Day close summary',
        'Original',
        '15 Mangsir 2083',
        'Test Accountant',
        'Cash book',
        'Opening balance',
        'Money in',
        '4,810.00',
        'Money out',
        '1,210.00',
        'Closing balance',
        'Rs. 1,000',
        'Counted',
        '1,300.00',
        'Cashbook says',
        formatReceiptAmount(expectedCash),
        130_000 < expectedCash ? 'Short' : 'Over',
        formatReceiptAmount(Math.abs(130_000 - expectedCash)),
        'One note was torn.',
        'Fonepay QR',
        'Net (Rs.)',
        '7,100.00',
        '3,550.00',
        'Bank interest',
        'Stationery and teaching',
        'Utilities',
        'Void of expense: Typed twice. Wrong amount, voided by Test Super Admin.',
        `Void of receipt ${fonepay.snapshot.receiptNo}. Wrong amount, voided by Test Super Admin.`,
        'Moved between accounts',
        'Cash in hand to Current account',
        '500.00',
      ]) {
        expect(original.text).toContain(text)
      }
      const copy = await summary(counter, date)
      expect(copy.text).toContain('Copy of original, print #2')
      expect(copy.text).not.toContain('Original')
      expect(await other.db.dayClosePrint.findMany({ where: { dayCloseId: row.id }, orderBy: { printNo: 'asc' }, select: { printNo: true, computer: true } })).toEqual([
        { printNo: 1, computer: 2 },
        { printNo: 2, computer: 2 },
      ])
    } finally {
      await day.other.close()
    }
  })

  it('the day-close summary reprint is unchanged after an entry is added following the close', async () => {
    const day = await onDay(8, 16)
    try {
      const { accountant: counter, other, date } = day
      await saved(counter, '/incomes', entry(categories.interest, school.cashId, 500, 'Cash brought in for the test'))
      other.advanceMinutes(1)
      const closed = dayCloseSchema.parse((await post(counter, '/day-closes', { counts: [{ note: 500, count: 1 }] })).json())
      const original = await summary(counter, date)
      const originalAt = other.now()

      other.advanceMinutes(10)
      await saved(counter, '/expenses', entry(categories.stationery, school.cashId, 120, 'Chalk bought after the count'))
      const reprint = await summary(counter, date)
      expect(reprint.response.statusCode).toBe(200)

      // Only the print's own details differ: which print it is, and when it was printed.
      const printed = (at: Date) => printEn.document.printed(formatKathmanduTime(at), 2)
      expect(reprint.text).toContain('Copy of original, print #2')
      expect(
        reprint.text.replace('Copy of original, print #2', 'Original').replaceAll(printed(other.now()), printed(originalAt)),
      ).toBe(original.text)
      expect(reprint.text).not.toContain('Chalk bought after the count')

      // The cashbook says what was entered after the count; the bankbook has no count.
      const book = bookResponseSchema.parse((await get(counter, `/accounts/${school.cashId}/book?date=${date}`)).json())
      expect(book.dayClose).toEqual({ closedAt: closed.closedAt, entriesAfter: 1 })
      const bankBook = bookResponseSchema.parse((await get(counter, `/accounts/${school.bankId}/book?date=${date}`)).json())
      expect(bankBook.dayClose).toBeNull()
    } finally {
      await day.other.close()
    }
  })

  it('numbers the prints one after another when several are printed at once', async () => {
    const day = await onDay(8, 17)
    try {
      const { accountant: counter, other, date } = day
      await saved(counter, '/incomes', entry(categories.interest, school.cashId, 500, 'Cash brought in for the test'))
      expect((await post(counter, '/day-closes', { counts: [{ note: 500, count: 1 }] })).statusCode).toBe(200)
      const prints = await Promise.all(Array.from({ length: 5 }, () => post(counter, `/day-closes/${date}/print`)))
      expect(prints.map((response) => response.statusCode)).toEqual([200, 200, 200, 200, 200])
      const rows = await other.db.dayClosePrint.findMany({
        where: { dayClose: { closeDate: new Date(`${date}T00:00:00.000Z`) } },
        select: { printNo: true },
      })
      expect(rows.map((print) => print.printNo).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5])
    } finally {
      await day.other.close()
    }
  })

  it('says there is no summary for a day that has not been closed, and shows no count on its cashbook', async () => {
    const notClosed = bsToAd({ year: 2083, month: 8, day: 20 })
    expect(errorOf(await post(asAccountant, `/day-closes/${notClosed}/print`))).toEqual({
      status: 404,
      code: 'NOT_FOUND',
      message: 'This day has not been closed yet, so there is no day-close summary to print.',
    })
    const book = bookResponseSchema.parse((await get(asAccountant, `/accounts/${school.cashId}/book?date=${notClosed}`)).json())
    expect(book.dayClose).toBeNull()
  })
})

describe('voiding income and expenses', () => {
  it('voids an expense: the money comes back into the account it was paid from, dated today', async () => {
    await addCash(asAccountant, 1000)
    const expense = await saved(asAccountant, '/expenses', entry(categories.stationery, school.cashId, 700))
    const cash = await balance(asAccountant, school.cashId)

    await approveVoid({ type: 'expense', id: expense.id }, asAccountant, asAdmin)
    expect(await server.db.accountEntry.findMany({ where: { voidRecord: { expenseId: expense.id } } })).toMatchObject([
      { accountId: school.cashId, direction: 'in', amountPaisa: 70_000n, entryDate: new Date('2026-10-31T00:00:00.000Z') },
    ])
    expect(await balance(asAccountant, school.cashId)).toBe(cash + 70_000)
    // The cashbook's void line names the category of the expense it reverses.
    const book = bookResponseSchema.parse((await get(asAccountant, `/accounts/${school.cashId}/book?date=2026-10-31`)).json())
    expect(book.entries.map((item) => item.source)).toContainEqual(
      expect.objectContaining({
        type: 'void',
        target: { type: 'expense', description: 'Whiteboard markers and chalk', categoryName: 'Stationery and teaching' },
      }),
    )
    const again = await post(asAccountant, '/void-requests', {
      target: { type: 'expense', id: expense.id },
      reason: 'other',
      details: 'Again',
    })
    expect(errorOf(again)).toEqual({
      status: 409,
      code: 'ALREADY_VOIDED',
      message: 'This expense has already been voided. Refresh the list.',
    })
  })

  it('voids an income: the money goes back out of the account it came into', async () => {
    const income = await saved(asAccountant, '/incomes', entry(categories.interest, school.bankId, 1240, 'Interest for Ashwin'))
    const bank = await balance(asAccountant, school.bankId)

    await approveVoid({ type: 'income', id: income.id }, asAccountant, asAdmin)
    expect(await balance(asAccountant, school.bankId)).toBe(bank - 124_000)
    const pending = await post(asAdmin, '/void-requests', { target: { type: 'income', id: randomUUID() }, reason: 'other', details: 'x' })
    expect(errorOf(pending)).toMatchObject({ status: 404, code: 'NOT_FOUND' })
  })
})

describe('keeping cash at or above zero', () => {
  async function cashReceipt(as: Caller) {
    const student = await createStudent(as.on.db, school)
    const kartik = await addDue(as.on.db, school, student.id, { month: 7, rupees: 3550 })
    const response = await post(as, '/payments', {
      idempotencyKey: randomUUID(),
      studentId: student.id,
      method: 'cash',
      allocations: [{ kind: 'fee', feeDueId: kartik.id, amount: 355_000 }],
    })
    return collectPaymentResponseSchema.parse(response.json()).receipt
  }

  function move(as: Caller, from: string, to: string, amount: number) {
    return post(as, '/transfers', { idempotencyKey: randomUUID(), fromAccountId: from, toAccountId: to, amount })
  }

  it('refuses a void that would take cash below zero, until money comes back from the bank', async () => {
    const receipt = await cashReceipt(asAccountant)
    // Bank most of the cash, leaving Rs. 100 in the drawer.
    expect((await move(asAccountant, school.cashId, school.bankId, (await balance(asAccountant, school.cashId)) - 10_000)).statusCode).toBe(200)
    const asked = await post(asAccountant, '/void-requests', {
      target: { type: 'payment', id: receipt.paymentId },
      reason: 'wrong_student',
      details: 'Wrong student.',
    })
    const request = voidRequestSchema.parse(asked.json())

    expect(errorOf(await post(asAdmin, `/void-requests/${request.id}/approve`, {}))).toEqual({
      status: 422,
      code: 'INSUFFICIENT_CASH',
      message: 'Cash in hand is Rs. 100. Move money from the bank to cash first, or void later.',
    })
    expect(await server.db.voidRecord.count({ where: { paymentId: receipt.paymentId } })).toBe(0)

    // The way out: bring cash back from the bank, then approve.
    expect((await move(asAccountant, school.bankId, school.cashId, 355_000)).statusCode).toBe(200)
    expect((await post(asAdmin, `/void-requests/${request.id}/approve`, {})).statusCode).toBe(200)
    expect(await balance(asAccountant, school.cashId)).toBe(10_000)
  })

  it('applies the same check to income and to direct voids, but never to an expense coming back', async () => {
    const income = await saved(asAccountant, '/incomes', entry(categories.interest, school.cashId, 500, 'Sold old newspapers'))
    const expense = await saved(asAccountant, '/expenses', entry(categories.stationery, school.cashId, 200))
    expect((await move(asAccountant, school.cashId, school.bankId, await balance(asAccountant, school.cashId))).statusCode).toBe(200)

    const direct = (target: object) => post(asAdmin, '/voids', { target, reason: 'other', details: 'Entered by mistake.' })
    expect(errorOf(await direct({ type: 'income', id: income.id }))).toMatchObject({ status: 422, code: 'INSUFFICIENT_CASH' })
    expect((await direct({ type: 'expense', id: expense.id })).statusCode).toBe(200)
    expect(await balance(asAccountant, school.cashId)).toBe(20_000)
  })

  it('refuses to close a day while the cashbook shows less than nothing in cash', async () => {
    const later = await onDay(1, 10, 2090)
    try {
      // Only entries made outside the app could do this; the server still answers clearly. The
      // money comes back the next day, so cash overall never drops for the tests that follow.
      const out = new Date(`${later.date}T00:00:00.000Z`)
      const back = new Date(`${bsToAd({ year: 2090, month: 1, day: 11 })}T00:00:00.000Z`)
      const amountPaisa = 100_000_000n
      const fields = { accountId: school.cashId, amountPaisa, description: 'Entered outside the app', enteredById: accountant.id }
      const expense = await later.other.db.expense.create({
        data: { ...fields, idempotencyKey: randomUUID(), categoryId: categories.utilities, expenseDate: out },
      })
      const income = await later.other.db.income.create({
        data: { ...fields, idempotencyKey: randomUUID(), categoryId: categories.interest, incomeDate: back },
      })
      await later.other.db.accountEntry.create({ data: { accountId: school.cashId, entryDate: out, direction: 'out', amountPaisa, expenseId: expense.id } })
      await later.other.db.accountEntry.create({ data: { accountId: school.cashId, entryDate: back, direction: 'in', amountPaisa, incomeId: income.id } })

      const status = dayCloseStatusSchema.parse((await get(later.accountant, `/day-closes/${later.date}`)).json())
      expect(status.expectedCash).toBeLessThan(0)
      const response = await post(later.accountant, '/day-closes', { counts: [{ note: 100, count: 1 }] })
      expect(errorOf(response)).toMatchObject({ status: 422, code: 'CASH_BELOW_ZERO' })
      expect(errorOf(response).message).toContain('less than nothing in cash')
    } finally {
      await later.other.close()
    }
  })

  it('says which balances are below zero, and zero is not below zero', async () => {
    const listed = async () => accountsResponseSchema.parse((await get(asAccountant, '/accounts')).json()).accounts
    const bankListed = async () => (await listed()).find((account) => account.id === school.bankId)

    // Whatever earlier tests left, spend from the bank until it is under zero, then bring it back to exactly zero.
    const spend = Math.max(await balance(asAccountant, school.bankId), 0) + 100
    await saved(asAccountant, '/expenses', { ...entry(categories.utilities, school.bankId, 1, 'Bigger than the bank balance'), amount: spend })
    const under = await balance(asAccountant, school.bankId)
    expect(under).toBeLessThan(0)
    for (const account of await listed()) {
      expect(account.belowZero).toBe(account.balance < 0)
    }
    expect(await bankListed()).toMatchObject({ belowZero: true })

    await saved(asAccountant, '/incomes', { ...entry(categories.interest, school.bankId, 1, 'Bank brought back to zero'), amount: -under })
    expect(await bankListed()).toMatchObject({ balance: 0, belowZero: false })
  })
})
