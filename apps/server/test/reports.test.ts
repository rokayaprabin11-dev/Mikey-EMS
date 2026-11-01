import { randomUUID } from 'node:crypto'

import type { User } from '@mikey/db'
import { bookResponseSchema, bsToAd, collectPaymentResponseSchema, type Report, reportSchema, voidRequestSchema } from '@mikey/shared'
import ExcelJS from 'exceljs'
import PDFDocument from 'pdfkit'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

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
const COUNTER = '192.168.1.85'

let school: School
let admin: User
let accountant: User
let expenseCategoryId: string

interface Day {
  server: TestServer
  date: string
  accountant: { token: string; ip: string }
  admin: { token: string }
}

const days: TestServer[] = []

// A server whose clock is on a day of Kartik 2083, at 10:00 AM.
async function onKartik(day: number): Promise<Day> {
  const server = startTestServer()
  days.push(server)
  const date = bsToAd({ year: 2083, month: 7, day })
  server.advanceMinutes((new Date(`${date}T10:00:00+05:45`).getTime() - server.now().getTime()) / 60_000)
  return {
    server,
    date,
    accountant: { token: await signIn(server, accountant, COUNTER), ip: COUNTER },
    admin: { token: await signIn(server, admin) },
  }
}

const setup = startTestServer()
days.push(setup)

beforeAll(async () => {
  school = await ensureSchool(setup.db)
  admin = await createUser(setup.db, 'super_admin')
  accountant = await createUser(setup.db, 'accountant')
  await allowComputer(setup.db, COUNTER, admin)
  expenseCategoryId = (await setup.db.expenseCategory.create({ data: { name: 'Stationery and teaching' } })).id
})

afterAll(async () => {
  for (const server of days) {
    await server.close()
  }
})

function call(day: Day, as: 'accountant' | 'admin', method: 'GET' | 'POST', path: string, body?: object) {
  return day.server.call({ method, path, ...day[as], body })
}

async function report(day: Day, type: Report['type'], from: string, to: string): Promise<Report> {
  const response = await call(day, 'accountant', 'GET', `/reports?type=${type}&from=${from}&to=${to}`)
  expect(response.statusCode, response.body).toBe(200)
  return reportSchema.parse(response.json())
}

async function collect(day: Day, studentName: string, rupees: number, method: object = { method: 'cash' }) {
  const student = await createStudent(day.server.db, school, studentName)
  const due = await addDue(day.server.db, school, student.id, { month: 7, rupees })
  day.server.advanceMinutes(1)
  const response = await call(day, 'accountant', 'POST', '/payments', {
    idempotencyKey: randomUUID(),
    studentId: student.id,
    ...method,
    allocations: [{ kind: 'fee', feeDueId: due.id, amount: rupees * 100 }],
  })
  expect(response.statusCode, response.body).toBe(200)
  return collectPaymentResponseSchema.parse(response.json()).receipt
}

async function spend(day: Day, rupees: number, description: string, voucherNo?: string, categoryId = expenseCategoryId) {
  day.server.advanceMinutes(1)
  const response = await call(day, 'accountant', 'POST', '/expenses', {
    idempotencyKey: randomUUID(),
    categoryId,
    accountId: school.cashId,
    amount: rupees * 100,
    description,
    ...(voucherNo === undefined ? {} : { voucherNo }),
  })
  expect(response.statusCode, response.body).toBe(200)
  return response.json<{ id: string }>()
}

async function voidIt(day: Day, target: { type: 'payment' | 'expense'; id: string }) {
  day.server.advanceMinutes(1)
  const asked = await call(day, 'accountant', 'POST', '/void-requests', { target, reason: 'wrong_amount', details: 'Typed the wrong amount.' })
  const request = voidRequestSchema.parse(asked.json())
  const approved = await call(day, 'admin', 'POST', `/void-requests/${request.id}/approve`, {})
  expect(approved.statusCode, approved.body).toBe(200)
}

// What the cashbook and bankbook show for fees over the days: receipts in, their voids out.
async function bookFeeLines(day: Day, dates: readonly string[]) {
  const lines: { kind: 'receipt' | 'void'; receiptNo: string; amount: number }[] = []
  for (const date of dates) {
    for (const accountId of [school.cashId, school.bankId]) {
      const book = bookResponseSchema.parse((await call(day, 'accountant', 'GET', `/accounts/${accountId}/book?date=${date}`)).json())
      for (const entry of book.entries) {
        if (entry.source.type === 'payment') {
          lines.push({ kind: 'receipt', receiptNo: entry.source.receiptNo, amount: entry.amount })
        } else if (entry.source.type === 'void' && entry.source.target.type === 'payment') {
          lines.push({ kind: 'void', receiptNo: entry.source.target.receiptNo, amount: entry.amount })
        }
      }
    }
  }
  return lines
}

// The rupee format, with its own sections for lakhs and crores. (ExcelJS drops the backslashes
// that make the commas literal when it reads a file back; the file keeps them.)
const RUPEES = /^\[>=10000000\]"Rs\. ".*;\[>=100000\]"Rs\. ".*;"Rs\. "##,##0\.00$/

// @types/pdfkit types the default export as a document rather than a class with a prototype.
const pdfDocument = (PDFDocument as unknown as { prototype: PDFKit.PDFDocument }).prototype

async function pdfText(day: Day, path: string) {
  const text = vi.spyOn(pdfDocument, 'text')
  try {
    const response = await call(day, 'accountant', 'GET', path)
    return { response, text: text.mock.calls.map(([value]) => String(value)).join('|') }
  } finally {
    text.mockRestore()
  }
}

async function workbook(day: Day, path: string, sheetIndex = 0) {
  const response = await call(day, 'accountant', 'GET', path)
  expect(response.statusCode, response.body).toBe(200)
  expect(response.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  const book = new ExcelJS.Workbook()
  await book.xlsx.load(new Uint8Array(response.rawPayload).buffer)
  const sheet = book.worksheets[sheetIndex]
  if (sheet === undefined) {
    throw new Error(`The workbook has no sheet ${sheetIndex + 1}.`)
  }
  return sheet
}

describe('reports', () => {
  let first: Day
  let second: Day
  let third: Day
  let cashReceipt: Awaited<ReturnType<typeof collect>>
  const range = () => [first.date, second.date, third.date] as const

  beforeAll(async () => {
    first = await onKartik(2)
    second = await onKartik(3)
    third = await onKartik(4)
    cashReceipt = await collect(first, 'Aarav Shrestha', 3550)
    await collect(first, 'Sujata Tamang', 2000, { method: 'fonepay', reference: 'FP-1182' })
    await collect(first, 'Anisha Maharjan', 125_000)
  })

  it('the fee collection report total equals the cashbook receipt lines for the same range', async () => {
    await spend(second, 450, 'Whiteboard markers and chalk', 'V-214')
    const typedTwice = await spend(second, 260, 'Chalk typed twice')
    await voidIt(second, { type: 'expense', id: typedTwice.id })

    const fees = await report(third, 'fee_collection', first.date, third.date)
    if (fees.type !== 'fee_collection') {
      throw new Error('Expected the fee collection report.')
    }
    const lines = await bookFeeLines(third, range())
    expect(fees.rows.map((row) => ({ kind: row.kind, receiptNo: row.receiptNo, amount: row.amount }))).toEqual(
      expect.arrayContaining(lines),
    )
    expect(fees.rows).toHaveLength(lines.length)
    const sumOf = (kind: 'receipt' | 'void') => lines.filter((line) => line.kind === kind).reduce((sum, line) => sum + line.amount, 0)
    expect(fees.totals).toEqual({ received: sumOf('receipt'), voided: sumOf('void'), net: sumOf('receipt') - sumOf('void') })
    expect(fees.totals.received).toBe(355_000 + 200_000 + 12_500_000)
    expect(fees.header).toMatchObject({ schoolName: 'Mikey English Medium School', from: first.date, to: third.date, generatedBy: 'Test Accountant' })
  })

  it('a voided receipt appears as its own line and the total drops by its amount', async () => {
    const before = await report(second, 'fee_collection', first.date, third.date)
    await voidIt(second, { type: 'payment', id: cashReceipt.paymentId })
    const after = await report(second, 'fee_collection', first.date, third.date)
    if (before.type !== 'fee_collection' || after.type !== 'fee_collection') {
      throw new Error('Expected the fee collection report.')
    }

    const forReceipt = after.rows.filter((row) => row.receiptNo === cashReceipt.snapshot.receiptNo)
    expect(forReceipt.map((row) => [row.kind, row.date, row.amount])).toEqual([
      ['receipt', first.date, 355_000],
      ['void', second.date, 355_000],
    ])
    expect(forReceipt[1]).toMatchObject({ reason: 'wrong_amount', voidedBy: 'Test Super Admin', studentName: 'Aarav Shrestha' })
    expect(after.totals.net).toBe(before.totals.net - 355_000)
    expect(after.totals.received).toBe(before.totals.received)

    // A report that ends before the void still counts the receipt.
    const firstDayOnly = await report(second, 'fee_collection', first.date, first.date)
    expect(firstDayOnly.type === 'fee_collection' && firstDayOnly.rows.map((row) => row.kind)).toEqual(['receipt', 'receipt', 'receipt'])
  })

  it('the Excel amount cells are numeric', async () => {
    const sheet = await workbook(third, `/reports/xlsx?type=fee_collection&from=${first.date}&to=${third.date}`)
    expect(sheet.getCell('A1').value).toBe('Mikey English Medium School')
    expect(sheet.getCell('A2').value).toBe('Fee collection')
    expect(sheet.getCell('A3').value).toBe('From 2 Kartik 2083 (19 Oct 2026) to 4 Kartik 2083 (21 Oct 2026)')
    expect(sheet.getRow(7).values).toEqual([
      undefined,
      'Date (BS)',
      'Date (AD)',
      'Receipt no.',
      'Student',
      'Class',
      'Method',
      'Received (Rs.)',
      'Voided (Rs.)',
    ])

    const received: number[] = []
    const voided: number[] = []
    for (let rowNumber = 8; rowNumber <= 11; rowNumber += 1) {
      const row = sheet.getRow(rowNumber)
      expect(row.getCell(1).value).toMatch(/^\d+ Kartik 2083$/)
      expect(row.getCell(2).value).toBeInstanceOf(Date)
      for (const [column, list] of [
        [7, received],
        [8, voided],
      ] as const) {
        const cell = row.getCell(column)
        if (cell.value !== null) {
          expect(typeof cell.value).toBe('number')
          expect(cell.type).toBe(ExcelJS.ValueType.Number)
          expect(cell.numFmt).toMatch(RUPEES)
          list.push(cell.value as number)
        }
      }
    }
    expect(received).toEqual([3550, 2000, 125_000])
    expect(voided).toEqual([3550])

    const totals = sheet.getRow(12)
    expect(totals.getCell(1).value).toBe('Total')
    expect(totals.getCell(7).value).toEqual({ formula: 'SUM(G8:G11)', result: 130_550 })
    expect(totals.getCell(8).value).toEqual({ formula: 'SUM(H8:H11)', result: 3550 })
    expect(totals.getCell(7).numFmt).toMatch(RUPEES)
    const net = sheet.getRow(13)
    expect(net.getCell(6).value).toBe('Net collected')
    expect(net.getCell(7).value).toEqual({ formula: 'G12-H12', result: 127_000 })
  })

  it('prints the report on A4, with the period and the generated line BS first, and rupees in lakhs', async () => {
    const { response, text } = await pdfText(third, `/reports/pdf?type=fee_collection&from=${first.date}&to=${third.date}`)
    expect(response.statusCode, response.body).toBe(200)
    expect(response.headers['content-type']).toBe('application/pdf')
    expect(response.rawPayload.toString('latin1')).toContain('/MediaBox [0 0 595.28 841.89]')
    for (const expected of [
      'Mikey English Medium School',
      'Fee collection',
      'From 2 Kartik 2083 (19 Oct 2026) to 4 Kartik 2083 (21 Oct 2026)',
      'Generated 4 Kartik 2083 (21 Oct 2026), 10:',
      'by Test Accountant',
      '2 Kartik 2083',
      '19 Oct 2026',
      'Void: Aarav Shrestha (Wrong amount, voided by Test Super Admin)',
      '1,25,000.00',
      '1,30,550.00',
      'Net collected 1,27,000.00',
      'Page 1 of 1',
    ]) {
      expect(text).toContain(expected)
    }
  })

  it('lists expenses in the period, each void as its own line, and adds them up by category', async () => {
    const utilities = await third.server.db.expenseCategory.create({ data: { name: 'Utilities' } })
    await spend(third, 1200, 'Electricity bill', undefined, utilities.id)
    const expenses = await report(third, 'expenses', first.date, third.date)
    if (expenses.type !== 'expenses') {
      throw new Error('Expected the expenses report.')
    }
    expect(expenses.rows.map((row) => [row.kind, row.categoryName, row.description, row.voucherNo, row.amount])).toEqual([
      ['expense', 'Stationery and teaching', 'Whiteboard markers and chalk', 'V-214', 45_000],
      ['expense', 'Stationery and teaching', 'Chalk typed twice', null, 26_000],
      ['void', 'Stationery and teaching', 'Chalk typed twice', null, 26_000],
      ['expense', 'Utilities', 'Electricity bill', null, 120_000],
    ])
    expect(expenses.byCategory).toEqual([
      { name: 'Stationery and teaching', spent: 71_000, voided: 26_000 },
      { name: 'Utilities', spent: 120_000, voided: 0 },
    ])
    expect(expenses.totals).toEqual({ spent: 191_000, voided: 26_000, net: 165_000 })

    const path = `/reports/xlsx?type=expenses&from=${first.date}&to=${third.date}`
    const sheet = await workbook(third, path)
    expect(sheet.name).toBe('Expenses')
    expect(sheet.getCell('D8').value).toBe('Whiteboard markers and chalk, voucher V-214')
    expect(sheet.getCell('F12').value).toEqual({ formula: 'SUM(F8:F11)', result: 1910 })

    // The second sheet adds up the first sheet's lines for each category, with formulas.
    const byCategory = await workbook(third, path, 1)
    expect(byCategory.name).toBe('By category')
    expect(byCategory.getCell('A2').value).toBe('Expenses by category')
    expect(byCategory.getRow(7).values).toEqual([undefined, 'Category', 'Spent (Rs.)', 'Voided (Rs.)'])
    expect(byCategory.getCell('A8').value).toBe('Stationery and teaching')
    expect(byCategory.getCell('B8').value).toEqual({ formula: "SUMIFS('Expenses'!$F$8:$F$11,'Expenses'!$C$8:$C$11,$A8)", result: 710 })
    expect(byCategory.getCell('C8').value).toEqual({ formula: "SUMIFS('Expenses'!$G$8:$G$11,'Expenses'!$C$8:$C$11,$A8)", result: 260 })
    expect(byCategory.getCell('B9').value).toEqual({ formula: "SUMIFS('Expenses'!$F$8:$F$11,'Expenses'!$C$8:$C$11,$A9)", result: 1200 })
    expect(byCategory.getCell('B10').value).toEqual({ formula: 'SUM(B8:B9)', result: 1910 })
    expect(byCategory.getCell('A11').value).toBe('Net spent')
    expect(byCategory.getCell('B11').value).toEqual({ formula: 'B10-C10', result: 1650 })

    const { text } = await pdfText(third, `/reports/pdf?type=expenses&from=${first.date}&to=${third.date}`)
    for (const expected of ['By category', 'Utilities', '1,200.00', '1,910.00', 'Net spent 1,650.00']) {
      expect(text).toContain(expected)
    }
  })

  it('shows the dues billed in the period by class, with what is still owed on them', async () => {
    const student = await createStudent(third.server.db, school, 'Bibek Lama')
    const kartik = await addDue(third.server.db, school, student.id, { month: 7, rupees: 3680 })
    await addDue(third.server.db, school, student.id, { month: 8, rupees: 3680 })
    third.server.advanceMinutes(1)
    const paid = await call(third, 'accountant', 'POST', '/payments', {
      idempotencyKey: randomUUID(),
      studentId: student.id,
      method: 'cash',
      allocations: [{ kind: 'fee', feeDueId: kartik.id, amount: 100_000 }],
    })
    expect(paid.statusCode, paid.body).toBe(200)

    const kartikRange = { from: bsToAd({ year: 2083, month: 7, day: 1 }), to: bsToAd({ year: 2083, month: 7, day: 30 }) }
    const dues = await report(third, 'dues', kartikRange.from, kartikRange.to)
    if (dues.type !== 'dues') {
      throw new Error('Expected the dues report.')
    }
    // Four students had Kartik dues: Rs. 3,550, 2,000, 1,25,000 and 3,680. Voiding the cash receipt
    // left Aarav owing his 3,550 again, and Bibek paid 1,000 of his. His Mangsir due is outside the
    // period.
    const totals = { studentsBilled: 4, studentsOwing: 2, billed: 13_423_000, paid: 12_800_000, outstanding: 623_000 }
    expect(dues.rows).toEqual([{ className: 'Class 7', ...totals }])
    expect(dues.totals).toEqual(totals)
    // What is still owed is as of when the report was made, and both the workbook and the PDF say so.
    const asOf = /^Outstanding as of 4 Kartik 2083 \(21 Oct 2026\), 10:\d\d AM$/
    const sheet = await workbook(third, `/reports/xlsx?type=dues&from=${kartikRange.from}&to=${kartikRange.to}`)
    expect(sheet.getCell('A4').value).toMatch(asOf)
    expect(sheet.getCell('G9').value).toEqual({ formula: 'IF(D9=0,0,E9/D9)', result: 12_800_000 / 13_423_000 })
    expect(sheet.getCell('D10').value).toEqual({ formula: 'SUM(D9:D9)', result: 134_230 })
    const { text } = await pdfText(third, `/reports/pdf?type=dues&from=${kartikRange.from}&to=${kartikRange.to}`)
    expect(text.split(/[|\n]/)).toContainEqual(expect.stringMatching(asOf))
  })

  it('lists the day closes in the period with what was short or over', async () => {
    third.server.advanceMinutes(1)
    const closed = await call(third, 'accountant', 'POST', '/day-closes', { counts: [{ note: 1000, count: 1 }], note: 'Counted twice.' })
    expect(closed.statusCode, closed.body).toBe(200)
    const closes = await report(third, 'day_closes', first.date, third.date)
    if (closes.type !== 'day_closes') {
      throw new Error('Expected the day closes report.')
    }
    expect(closes.rows).toHaveLength(1)
    const [row] = closes.rows
    expect(row).toMatchObject({ date: third.date, closedBy: 'Test Accountant', countedCash: 100_000, note: 'Counted twice.' })
    const difference = row?.difference ?? 0
    expect(closes.totals).toEqual({ short: Math.max(0, -difference), over: Math.max(0, difference) })
  })

  it('refuses a period that ends before it starts, and a report it does not know', async () => {
    expect(errorOf(await call(third, 'accountant', 'GET', `/reports?type=dues&from=${third.date}&to=${first.date}`))).toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
    })
    expect(errorOf(await call(third, 'accountant', 'GET', `/reports?type=payroll&from=${first.date}&to=${third.date}`))).toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
    })
  })
})
