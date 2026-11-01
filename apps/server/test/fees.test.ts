import { randomUUID } from 'node:crypto'

import type { User } from '@mikey/db'
import { bsMonthName, bsToAd, collectPaymentResponseSchema, daysInBsMonth, studentDuesResponseSchema } from '@mikey/shared'
import PDFDocument from 'pdfkit'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  addDue,
  addFine,
  allowComputer,
  createStudent,
  createUser,
  ensureSchool,
  errorOf,
  type School,
  SCHOOL_PROFILE,
  signIn,
  startTestServer,
  type TestServer,
} from './support.ts'

// The Accountant's computer, Computer 2.
const COUNTER = '192.168.1.80'

const server: TestServer = startTestServer()
let school: School
let accountant: User
let token: string

beforeAll(async () => {
  school = await ensureSchool(server.db)
  const admin = await createUser(server.db, 'super_admin')
  accountant = await createUser(server.db, 'accountant')
  await allowComputer(server.db, COUNTER, admin)
})

beforeEach(async () => {
  token = await signIn(server, accountant, COUNTER)
})

afterAll(() => server.close())

type Allocation = { kind: 'fee'; feeDueId: string; amount: number } | { kind: 'fine'; fineId: string; amount: number }

const fee = (feeDueId: string, rupees: number): Allocation => ({ kind: 'fee', feeDueId, amount: rupees * 100 })
const fine = (fineId: string, rupees: number): Allocation => ({ kind: 'fine', fineId, amount: rupees * 100 })

function payment(studentId: string, allocations: Allocation[], extra: { method?: string; reference?: string } = {}) {
  return { idempotencyKey: randomUUID(), studentId, method: 'cash', allocations, ...extra }
}

function collect(body: object, on: TestServer = server, as = token) {
  return on.call({ method: 'POST', path: '/payments', ip: COUNTER, token: as, body })
}

async function collected(body: object, on: TestServer = server, as = token) {
  const response = await collect(body, on, as)
  expect(response.statusCode, response.body).toBe(200)
  return collectPaymentResponseSchema.parse(response.json())
}

function print(paymentId: string) {
  return server.call({ method: 'POST', path: `/payments/${paymentId}/print`, ip: COUNTER, token, body: { printKey: randomUUID() } })
}

// @types/pdfkit types the default export as a document rather than a class with a prototype.
const pdfDocument = (PDFDocument as unknown as { prototype: PDFKit.PDFDocument }).prototype

// Prints and collects every piece of text drawn on the PDF.
async function printWithText(paymentId: string) {
  const text = vi.spyOn(pdfDocument, 'text')
  try {
    const response = await print(paymentId)
    return { response, text: text.mock.calls.map(([value]) => String(value)).join('') }
  } finally {
    text.mockRestore()
  }
}

function feeDue(id: string) {
  return server.db.feeDue.findUniqueOrThrow({ where: { id } })
}

describe("a student's dues", () => {
  it('lists what is still owed, oldest first, with each fine after its due', async () => {
    const student = await createStudent(server.db, school)
    const annual = await addDue(server.db, school, student.id, { month: 1, rupees: 7360, head: 'annual' })
    const ashwin = await addDue(server.db, school, student.id, { month: 6, rupees: 3680 })
    const lateFine = await addFine(server.db, ashwin.id, 100)
    const kartik = await addDue(server.db, school, student.id, { month: 7, rupees: 3680, discountRupees: 500 })
    const waived = await addFine(server.db, kartik.id, 100, 'Late fine, Kartik 2083')
    await server.db.fine.update({ where: { id: waived.id }, data: { waivedAt: server.now(), waivedById: accountant.id } })
    const mangsir = await addDue(server.db, school, student.id, { month: 8, rupees: 3680 })
    await server.db.feeDue.update({ where: { id: mangsir.id }, data: { status: 'cancelled' } })
    await collected(payment(student.id, [fee(annual.id, 7360), fee(ashwin.id, 2000)]))

    const response = await server.call({ method: 'GET', path: `/students/${student.id}/dues`, ip: COUNTER, token })
    expect(response.statusCode).toBe(200)
    expect(studentDuesResponseSchema.parse(response.json())).toEqual({
      studentId: student.id,
      items: [
        {
          kind: 'fee',
          feeDueId: ashwin.id,
          headName: 'Monthly tuition',
          periodLabel: 'Ashwin 2083',
          dueDate: bsToAd({ year: 2083, month: 6, day: 15 }),
          amount: 368_000,
          discount: 0,
          paid: 200_000,
          remaining: 168_000,
        },
        {
          kind: 'fine',
          fineId: lateFine.id,
          feeDueId: ashwin.id,
          headName: 'Monthly tuition',
          periodLabel: 'Ashwin 2083',
          reason: 'Late fine, Ashwin 2083',
          amount: 10_000,
          remaining: 10_000,
        },
        {
          kind: 'fee',
          feeDueId: kartik.id,
          headName: 'Monthly tuition',
          periodLabel: 'Kartik 2083',
          dueDate: bsToAd({ year: 2083, month: 7, day: 15 }),
          amount: 368_000,
          discount: 50_000,
          paid: 0,
          remaining: 318_000,
        },
      ],
      total: 496_000,
    })
  })

  it('stops counting the money of a voided payment', async () => {
    const student = await createStudent(server.db, school)
    const kartik = await addDue(server.db, school, student.id, { month: 7, rupees: 3680 })
    const { receipt } = await collected(payment(student.id, [fee(kartik.id, 3680)]))
    await server.db.voidRecord.create({
      data: { paymentId: receipt.paymentId, reason: 'wrong_student', voidedById: accountant.id },
    })

    const response = await server.call({ method: 'GET', path: `/students/${student.id}/dues`, ip: COUNTER, token })
    expect(studentDuesResponseSchema.parse(response.json())).toMatchObject({
      items: [{ feeDueId: kartik.id, paid: 0, remaining: 368_000 }],
      total: 368_000,
    })
  })

  it('says when the student does not exist', async () => {
    const response = await server.call({ method: 'GET', path: `/students/${randomUUID()}/dues`, ip: COUNTER, token })
    expect(errorOf(response)).toMatchObject({ status: 404, code: 'NOT_FOUND' })
  })
})

describe('collecting a fee', () => {
  it('saves the payment, its receipt, the cash entry and an audit row together', async () => {
    const student = await createStudent(server.db, school)
    const ashwin = await addDue(server.db, school, student.id, { month: 6, rupees: 3680 })
    const lateFine = await addFine(server.db, ashwin.id, 100)
    const kartik = await addDue(server.db, school, student.id, { month: 7, rupees: 3680 })

    const { receipt, alreadySaved } = await collected(
      payment(student.id, [fee(ashwin.id, 3680), fine(lateFine.id, 100), fee(kartik.id, 3680)]),
    )

    expect(alreadySaved).toBe(false)
    expect(receipt).toMatchObject({ status: 'posted', printCount: 0 })
    expect(receipt.snapshot).toEqual({
      version: 1,
      school: {
        name: SCHOOL_PROFILE.name,
        address: SCHOOL_PROFILE.address,
        phone: SCHOOL_PROFILE.phone,
        pan: SCHOOL_PROFILE.pan,
        logo: null,
      },
      receiptNo: expect.stringMatching(/^2083\/84-\d{6}$/) as unknown,
      fiscalYear: '2083/84',
      sessionName: '2083',
      issuedAt: server.now().toISOString(),
      date: { ad: '2026-10-31', bs: '2083-07-14' },
      student: {
        code: student.studentCode,
        fullName: 'Bibek Lama',
        className: 'Class 7',
        sectionName: 'A',
        rollNo: expect.any(Number) as unknown,
        guardianName: 'Pasang Lama',
      },
      months: 'Ashwin and Kartik 2083',
      lines: [
        { label: 'Monthly tuition, Ashwin 2083', amount: 368_000 },
        { label: 'Late fine, Ashwin 2083', amount: 10_000 },
        { label: 'Monthly tuition, Kartik 2083', amount: 368_000 },
      ],
      totals: { duesBefore: 746_000, discount: 0, amountPaid: 746_000, balanceAfter: 0 },
      amountInWords: 'Rupees Seven Thousand Four Hundred Sixty Only',
      method: 'cash',
      reference: null,
      receivedBy: 'Test Accountant',
    })

    const saved = await server.db.payment.findUniqueOrThrow({
      where: { id: receipt.paymentId },
      include: { allocations: true, receipt: true, accountEntries: true },
    })
    expect(saved).toMatchObject({
      studentId: student.id,
      method: 'cash',
      reference: null,
      amountPaisa: 746_000n,
      accountId: school.cashId,
      takenById: accountant.id,
      computer: 2,
      paidDate: new Date('2026-10-31T00:00:00.000Z'),
    })
    expect(saved.allocations).toHaveLength(3)
    expect(saved.receipt).toMatchObject({
      receiptNo: receipt.snapshot.receiptNo,
      fiscalYear: '2083/84',
      amountPaisa: 746_000n,
      duesBeforePaisa: 746_000n,
      discountPaisa: 0n,
      balanceAfterPaisa: 0n,
    })
    expect(saved.accountEntries).toMatchObject([
      { accountId: school.cashId, direction: 'in', amountPaisa: 746_000n, entryDate: new Date('2026-10-31T00:00:00.000Z') },
    ])
    expect(await feeDue(ashwin.id)).toMatchObject({ status: 'paid', version: 2 })
    expect(await feeDue(kartik.id)).toMatchObject({ status: 'paid', version: 2 })
    expect(await server.db.auditLog.findMany({ where: { recordId: receipt.paymentId } })).toMatchObject([
      {
        action: 'fees.payment_collected',
        userId: accountant.id,
        computer: 2,
        summary: `Collected Rs. 7,460 from Bibek Lama (Class 7 A), receipt ${receipt.snapshot.receiptNo}`,
      },
    ])
  })

  it('takes part of a due now and the rest later, carrying the balance from one receipt to the next', async () => {
    const student = await createStudent(server.db, school)
    const kartik = await addDue(server.db, school, student.id, { month: 7, rupees: 3680 })

    const first = await collected(payment(student.id, [fee(kartik.id, 2000)]))
    expect(first.receipt.snapshot.lines).toEqual([{ label: 'Monthly tuition, Kartik 2083 (part)', amount: 200_000 }])
    expect(first.receipt.snapshot.totals).toEqual({ duesBefore: 368_000, discount: 0, amountPaid: 200_000, balanceAfter: 168_000 })
    expect(await feeDue(kartik.id)).toMatchObject({ status: 'part_paid' })

    const second = await collected(payment(student.id, [fee(kartik.id, 1680)]))
    expect(second.receipt.snapshot.lines).toEqual([{ label: 'Monthly tuition, Kartik 2083 (balance)', amount: 168_000 }])
    expect(second.receipt.snapshot.totals).toEqual({ duesBefore: 168_000, discount: 0, amountPaid: 168_000, balanceAfter: 0 })
    expect(await feeDue(kartik.id)).toMatchObject({ status: 'paid' })
  })

  it('takes a non-cash payment into the bank account, with its reference', async () => {
    const student = await createStudent(server.db, school)
    const kartik = await addDue(server.db, school, student.id, { month: 7, rupees: 3680 })

    const { receipt } = await collected(
      payment(student.id, [fee(kartik.id, 3680)], { method: 'fonepay', reference: 'FP-7Q2K9M' }),
    )
    expect(receipt.snapshot).toMatchObject({ method: 'fonepay', reference: 'FP-7Q2K9M' })
    expect(await server.db.payment.findUniqueOrThrow({ where: { id: receipt.paymentId } })).toMatchObject({
      accountId: school.bankId,
      reference: 'FP-7Q2K9M',
    })
  })

  it('shows a discount already on a due, and counts the dues after it', async () => {
    const student = await createStudent(server.db, school)
    const kartik = await addDue(server.db, school, student.id, { month: 7, rupees: 3680, discountRupees: 500 })

    const { receipt } = await collected(payment(student.id, [fee(kartik.id, 3180)]))
    expect(receipt.snapshot.totals).toEqual({ duesBefore: 318_000, discount: 50_000, amountPaid: 318_000, balanceAfter: 0 })
    expect(await feeDue(kartik.id)).toMatchObject({ status: 'paid' })
  })

  it('refuses amounts that do not match what is owed, and then saves nothing at all', async () => {
    const student = await createStudent(server.db, school)
    const other = await createStudent(server.db, school, 'Kiran Ghimire')
    const kartik = await addDue(server.db, school, student.id, { month: 7, rupees: 3680 })
    const ashwin = await addDue(server.db, school, student.id, { month: 6, rupees: 3680 })
    await collected(payment(student.id, [fee(ashwin.id, 3680)]))
    const mangsir = await addDue(server.db, school, student.id, { month: 8, rupees: 3680 })
    await server.db.feeDue.update({ where: { id: mangsir.id }, data: { status: 'cancelled' } })
    const waived = await addFine(server.db, kartik.id, 100, 'Late fine, Kartik 2083')
    await server.db.fine.update({ where: { id: waived.id }, data: { waivedAt: server.now(), waivedById: accountant.id } })
    const othersDue = await addDue(server.db, school, other.id, { month: 7, rupees: 3550 })
    const paymentsBefore = await server.db.payment.count()

    const refusals: [Allocation, number, string][] = [
      [fee(kartik.id, 3681), 422, 'AMOUNT_EXCEEDS_DUE'],
      [fee(ashwin.id, 100), 409, 'DUE_ALREADY_PAID'],
      [fee(mangsir.id, 100), 409, 'DUE_NOT_OWED'],
      [fine(waived.id, 100), 409, 'DUE_NOT_OWED'],
      [fee(othersDue.id, 100), 404, 'NOT_FOUND'],
    ]
    for (const [allocation, status, code] of refusals) {
      expect(errorOf(await collect(payment(student.id, [allocation]))), code).toMatchObject({ status, code })
    }
    // One bad item refuses the whole payment, even when the rest is fine.
    expect(errorOf(await collect(payment(student.id, [fee(kartik.id, 100), fee(ashwin.id, 100)]))).code).toBe(
      'DUE_ALREADY_PAID',
    )
    expect(errorOf(await collect(payment(student.id, [fee(kartik.id, 3681)]))).message).toBe(
      'Rs. 3,681 is more than the Rs. 3,680 still due on Monthly tuition, Kartik 2083. Advance payments are not taken.',
    )
    expect(errorOf(await collect(payment(student.id, [fee(kartik.id, 100)], { reference: 'V-1' })))).toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
    })
    expect(await server.db.payment.count()).toBe(paymentsBefore)
    expect(await feeDue(kartik.id)).toMatchObject({ status: 'unpaid', version: 1 })
  })

  it('needs exactly one bank account for a non-cash payment', async () => {
    const student = await createStudent(server.db, school)
    const kartik = await addDue(server.db, school, student.id, { month: 7, rupees: 3680 })
    const extra = await server.db.account.create({ data: { name: 'Savings account', kind: 'bank' } })
    try {
      const response = await collect(payment(student.id, [fee(kartik.id, 100)], { method: 'esewa', reference: 'ESW-1' }))
      expect(errorOf(response)).toMatchObject({ status: 422, code: 'ACCOUNT_NOT_SET_UP' })
    } finally {
      await server.db.account.delete({ where: { id: extra.id } })
    }
  })

  it('returns the first receipt for a repeated request and saves nothing new', async () => {
    const student = await createStudent(server.db, school)
    const kartik = await addDue(server.db, school, student.id, { month: 7, rupees: 3680 })
    const body = payment(student.id, [fee(kartik.id, 3680)])
    const first = await collected(body)
    const counts = async () => ({
      payments: await server.db.payment.count({ where: { studentId: student.id } }),
      receipts: await server.db.receipt.count({ where: { payment: { studentId: student.id } } }),
      entries: await server.db.accountEntry.count({ where: { payment: { studentId: student.id } } }),
      audit: await server.db.auditLog.count({ where: { recordId: first.receipt.paymentId } }),
    })
    const before = await counts()

    expect(await collected(body)).toEqual({ receipt: first.receipt, alreadySaved: true })
    expect(await counts()).toEqual(before)
  })

  it('saves a request that arrives twice at the same moment only once', async () => {
    const student = await createStudent(server.db, school)
    const kartik = await addDue(server.db, school, student.id, { month: 7, rupees: 3680 })
    const body = payment(student.id, [fee(kartik.id, 3680)])

    const answers = await Promise.all([collect(body), collect(body)])
    const saved = answers.map((response) => collectPaymentResponseSchema.parse(response.json()))
    expect(saved.map((answer) => answer.alreadySaved).toSorted()).toEqual([false, true])
    expect(new Set(saved.map((answer) => answer.receipt.snapshot.receiptNo)).size).toBe(1)
    expect(await server.db.payment.count({ where: { studentId: student.id } })).toBe(1)
  })

  it('numbers receipts taken at the same moment for different students one after the other', async () => {
    const payers: object[] = []
    for (const name of ['Aarav Shrestha', 'Sujata Tamang', 'Prakriti Karki']) {
      const student = await createStudent(server.db, school, name)
      const kartik = await addDue(server.db, school, student.id, { month: 7, rupees: 3680 })
      payers.push(payment(student.id, [fee(kartik.id, 3680)]))
    }

    const answers = await Promise.all(payers.map((body) => collect(body)))
    expect(answers.map((response) => response.statusCode)).toEqual([200, 200, 200])
    const numbers = answers.map((response) => collectPaymentResponseSchema.parse(response.json()).receipt.snapshot.receiptNo)
    const seqs = numbers.map((receiptNo) => Number(receiptNo.slice(-6))).toSorted((a, b) => a - b)
    expect(seqs).toEqual([seqs[0], (seqs[0] ?? 0) + 1, (seqs[0] ?? 0) + 2])
  })

  it('lets only one of two payments for the same due through', async () => {
    const student = await createStudent(server.db, school)
    const kartik = await addDue(server.db, school, student.id, { month: 7, rupees: 3680 })

    const answers = await Promise.all([
      collect(payment(student.id, [fee(kartik.id, 3680)])),
      collect(payment(student.id, [fee(kartik.id, 3680)])),
    ])
    expect(answers.map((response) => response.statusCode).toSorted()).toEqual([200, 409])
    const refused = answers.find((response) => response.statusCode === 409)
    expect(refused === undefined ? null : errorOf(refused).code).toBe('DUE_ALREADY_PAID')
    expect(await server.db.payment.count({ where: { studentId: student.id } })).toBe(1)
  })

  it('numbers receipts one after another, with no gaps, within a fiscal year', async () => {
    const rows = await server.db.receipt.findMany({
      where: { fiscalYear: '2083/84' },
      select: { seq: true, receiptNo: true },
      orderBy: { seq: 'asc' },
    })
    expect(rows.length).toBeGreaterThan(5)
    expect(rows.map((row) => row.seq)).toEqual(rows.map((_row, index) => index + 1))
    expect(rows.every((row) => row.receiptNo === `2083/84-${String(row.seq).padStart(6, '0')}`)).toBe(true)
    expect(await server.db.receiptCounter.findUnique({ where: { fiscalYear: '2083/84' } })).toMatchObject({
      lastSeq: rows.length,
    })
  })

  it('starts again at 000001 on 1 Shrawan', async () => {
    const student = await createStudent(server.db, school)
    const asar = await addDue(server.db, school, student.id, { month: 3, rupees: 3680 })
    const shrawan = await addDue(server.db, school, student.id, { month: 4, rupees: 3680 })
    // A second server with its own clock, set to 10 AM on the last day of Asar 2089.
    const later = startTestServer()
    try {
      const lastOfAsar = bsToAd({ year: 2089, month: 3, day: daysInBsMonth(2089, 3) })
      later.advanceMinutes((new Date(`${lastOfAsar}T10:00:00+05:45`).getTime() - later.now().getTime()) / 60_000)
      const asarReceipt = await collected(payment(student.id, [fee(asar.id, 3680)]), later, await signIn(later, accountant, COUNTER))
      later.advanceMinutes(24 * 60)
      const shrawanReceipt = await collected(
        payment(student.id, [fee(shrawan.id, 3680)]),
        later,
        await signIn(later, accountant, COUNTER),
      )

      expect(asarReceipt.receipt.snapshot).toMatchObject({ receiptNo: '2088/89-000001', fiscalYear: '2088/89' })
      expect(shrawanReceipt.receipt.snapshot).toMatchObject({
        receiptNo: '2089/90-000001',
        fiscalYear: '2089/90',
        date: { bs: '2089-04-01' },
      })
    } finally {
      await later.close()
    }
  })
})

describe('receipts keep what they printed', () => {
  it('prints the old fee head, school details and student name after they change', async () => {
    const lab = await server.db.feeHead.create({ data: { name: 'Computer lab', kind: 'monthly' } })
    const student = await createStudent(server.db, school, 'Anisha Maharjan')
    const due = await server.db.feeDue.create({
      data: {
        studentId: student.id,
        sessionId: school.sessionId,
        feeHeadId: lab.id,
        periodLabel: `${bsMonthName(7)} 2083`,
        billDate: new Date(`${bsToAd({ year: 2083, month: 7, day: 1 })}T00:00:00.000Z`),
        dueDate: new Date(`${bsToAd({ year: 2083, month: 7, day: 15 })}T00:00:00.000Z`),
        amountPaisa: 50_000n,
      },
    })
    const body = payment(student.id, [fee(due.id, 500)])
    const { receipt } = await collected(body)

    await server.db.feeHead.update({ where: { id: lab.id }, data: { name: 'IT lab' } })
    await server.db.student.update({ where: { id: student.id }, data: { fullName: 'Anisha Shrestha' } })
    await server.db.setting.update({
      where: { key: 'school.profile' },
      data: { value: { ...SCHOOL_PROFILE, name: 'Mikey Secondary School', address: 'Dhulikhel-5, Kavrepalanchok' } },
    })
    try {
      const { response, text } = await printWithText(receipt.paymentId)
      expect(response.statusCode).toBe(200)
      expect(text).toContain('Computer lab, Kartik 2083')
      expect(text).toContain(SCHOOL_PROFILE.name)
      expect(text).toContain(SCHOOL_PROFILE.address)
      expect(text).toContain('Anisha Maharjan')
      expect(text).not.toMatch(/IT lab|Mikey Secondary School|Dhulikhel|Anisha Shrestha/)
      expect((await collected(body)).receipt.snapshot).toEqual(receipt.snapshot)
    } finally {
      await server.db.setting.update({ where: { key: 'school.profile' }, data: { value: SCHOOL_PROFILE } })
    }
  })
})

describe('printing the original', () => {
  it('prints the original once, as an A5 PDF, and records who printed it where', async () => {
    const student = await createStudent(server.db, school)
    const kartik = await addDue(server.db, school, student.id, { month: 7, rupees: 3680 })
    const { receipt } = await collected(payment(student.id, [fee(kartik.id, 3680)]))

    const { response, text } = await printWithText(receipt.paymentId)
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toBe('application/pdf')
    expect(response.rawPayload.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(response.rawPayload.toString('latin1')).toContain('/MediaBox [0 0 419.53 595.28]')
    expect(text).toContain('Original')
    expect(text).toContain('Printed 10:00 AM, Computer 2')
    expect(await server.db.receiptPrint.findMany({ where: { receipt: { paymentId: receipt.paymentId } } })).toMatchObject([
      { printNo: 1, computer: 2, printedById: accountant.id, printedAt: server.now() },
    ])

    expect(errorOf(await print(receipt.paymentId))).toMatchObject({ status: 409, code: 'ALREADY_PRINTED' })
    expect(errorOf(await print(randomUUID()))).toMatchObject({ status: 404, code: 'NOT_FOUND' })
  })

  it('gives the original to only one of two counters printing at the same moment', async () => {
    const student = await createStudent(server.db, school)
    const kartik = await addDue(server.db, school, student.id, { month: 7, rupees: 3680 })
    const { receipt } = await collected(payment(student.id, [fee(kartik.id, 3680)]))

    const answers = await Promise.all([print(receipt.paymentId), print(receipt.paymentId)])
    expect(answers.map((response) => response.statusCode).toSorted()).toEqual([200, 409])
    expect(await server.db.receiptPrint.count({ where: { receipt: { paymentId: receipt.paymentId } } })).toBe(1)
  })

  it('carries a long receipt over to a second page that starts with its number', async () => {
    const student = await createStudent(server.db, school)
    const dues: { id: string }[] = []
    for (let month = 1; month <= 10; month += 1) {
      dues.push(await addDue(server.db, school, student.id, { month, rupees: 3680 }))
    }
    const { receipt } = await collected(payment(student.id, dues.map((due) => fee(due.id, 3680))))

    const { response, text } = await printWithText(receipt.paymentId)
    expect(response.rawPayload.toString('latin1').match(/\/Type \/Page[^s]/g)).toHaveLength(2)
    for (let month = 1; month <= 10; month += 1) {
      expect(text).toContain(`Monthly tuition, ${bsMonthName(month)} 2083`)
    }
    expect(text.split(receipt.snapshot.receiptNo)).toHaveLength(3)
  })
})
