import { randomUUID } from 'node:crypto'

import type { User } from '@mikey/db'
import {
  collectPaymentResponseSchema,
  paymentsListResponseSchema,
  receiptSchema,
  studentDuesResponseSchema,
  voidRequestSchema,
  voidRequestsResponseSchema,
} from '@mikey/shared'
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
  signIn,
  startTestServer,
  type TestServer,
} from './support.ts'

// The Accountant works on Computer 2; the Super Admin on Computer 1.
const COUNTER = '192.168.1.81'

const server: TestServer = startTestServer()
let school: School
let admin: User
let accountant: User
let accountantToken: string
let adminToken: string

beforeAll(async () => {
  school = await ensureSchool(server.db)
  admin = await createUser(server.db, 'super_admin')
  accountant = await createUser(server.db, 'accountant')
  await allowComputer(server.db, COUNTER, admin)
})

beforeEach(async () => {
  accountantToken = await signIn(server, accountant, COUNTER)
  adminToken = await signIn(server, admin)
})

afterAll(() => server.close())

interface Caller {
  on: TestServer
  token: string
  ip?: string
}

const asAccountant = (): Caller => ({ on: server, token: accountantToken, ip: COUNTER })
const asAdmin = (): Caller => ({ on: server, token: adminToken })

function post(as: Caller, path: string, body?: object) {
  return as.on.call({ method: 'POST', path, token: as.token, ip: as.ip, body })
}

function get(as: Caller, path: string) {
  return as.on.call({ method: 'GET', path, token: as.token, ip: as.ip })
}

// A student with Kartik tuition (and anything else asked for) paid in cash by the Accountant.
async function paidReceipt(as: Caller = asAccountant(), extra: { fineOnAshwin?: boolean } = {}) {
  const student = await createStudent(as.on.db, school)
  const kartik = await addDue(as.on.db, school, student.id, { month: 7, rupees: 3550 })
  const allocations: object[] = [{ kind: 'fee', feeDueId: kartik.id, amount: 355_000 }]
  if (extra.fineOnAshwin === true) {
    const ashwin = await addDue(as.on.db, school, student.id, { month: 6, rupees: 3550 })
    const fine = await addFine(as.on.db, ashwin.id, 100)
    allocations.push({ kind: 'fee', feeDueId: ashwin.id, amount: 355_000 }, { kind: 'fine', fineId: fine.id, amount: 10_000 })
  }
  const response = await post(as, '/payments', {
    idempotencyKey: randomUUID(),
    studentId: student.id,
    method: 'cash',
    allocations,
  })
  expect(response.statusCode, response.body).toBe(200)
  const { receipt } = collectPaymentResponseSchema.parse(response.json())
  return { student, receipt, paymentId: receipt.paymentId }
}

// @types/pdfkit types the default export as a document rather than a class with a prototype.
const pdfDocument = (PDFDocument as unknown as { prototype: PDFKit.PDFDocument }).prototype

// Prints (the original or a copy) and collects every piece of text drawn on the PDF.
async function printed(as: Caller, paymentId: string, which: 'print' | 'reprint') {
  const text = vi.spyOn(pdfDocument, 'text')
  try {
    const response = await post(as, `/payments/${paymentId}/${which}`)
    return { response, text: text.mock.calls.map(([value]) => String(value)).join('') }
  } finally {
    text.mockRestore()
  }
}

function requestVoid(as: Caller, paymentId: string, details = 'Wrong student selected.') {
  return post(as, '/void-requests', { target: { type: 'payment', id: paymentId }, reason: 'wrong_student', details })
}

async function requested(as: Caller, paymentId: string) {
  const response = await requestVoid(as, paymentId)
  expect(response.statusCode, response.body).toBe(200)
  return voidRequestSchema.parse(response.json())
}

async function balance(on: TestServer, accountId: string): Promise<bigint> {
  const rows = await on.db.accountEntry.groupBy({ by: ['direction'], where: { accountId }, _sum: { amountPaisa: true } })
  const sum = (direction: 'in' | 'out') => rows.find((row) => row.direction === direction)?._sum.amountPaisa ?? 0n
  return sum('in') - sum('out')
}

describe('the payments list', () => {
  it("lists a day's receipts newest first as they were printed, with their status worked out", async () => {
    // A server whose clock is on a day no other test uses.
    const day = startTestServer()
    try {
      day.advanceMinutes(3 * 24 * 60)
      const accountantOnDay = { on: day, token: await signIn(day, accountant, COUNTER), ip: COUNTER }
      const adminOnDay = { on: day, token: await signIn(day, admin) }
      const posted = await paidReceipt(accountantOnDay)
      day.advanceMinutes(1)
      const asked = await paidReceipt(accountantOnDay)
      await requested(accountantOnDay, asked.paymentId)
      day.advanceMinutes(1)
      const voided = await paidReceipt(accountantOnDay)
      const request = await requested(accountantOnDay, voided.paymentId)
      expect((await post(adminOnDay, `/void-requests/${request.id}/approve`, {})).statusCode).toBe(200)
      await day.db.student.update({ where: { id: posted.student.id }, data: { fullName: 'Renamed Later' } })

      const list = async (filters: string) => {
        const response = await get(adminOnDay, `/payments?date=2026-11-03${filters}`)
        expect(response.statusCode, response.body).toBe(200)
        return paymentsListResponseSchema.parse(response.json())
      }
      const all = await list('')
      expect(all.payments.map((payment) => [payment.receiptNo, payment.status])).toEqual([
        [voided.receipt.snapshot.receiptNo, 'voided'],
        [asked.receipt.snapshot.receiptNo, 'void_requested'],
        [posted.receipt.snapshot.receiptNo, 'posted'],
      ])
      expect(all.total).toBe(2 * 355_000)
      expect(all.payments[2]).toMatchObject({
        student: { id: posted.student.id, fullName: 'Bibek Lama', className: 'Class 7', sectionName: 'A' },
        takenBy: 'Test Accountant',
        method: 'cash',
        amount: 355_000,
      })

      expect((await list('&status=voided')).payments.map((payment) => payment.paymentId)).toEqual([voided.paymentId])
      expect((await list('&status=void_requested')).payments.map((payment) => payment.paymentId)).toEqual([asked.paymentId])
      expect((await list('&status=posted')).payments.map((payment) => payment.paymentId)).toEqual([posted.paymentId])
      expect((await list('&method=fonepay')).payments).toEqual([])
      expect((await list(`&search=${encodeURIComponent(posted.receipt.snapshot.receiptNo)}`)).payments).toHaveLength(1)
      expect((await list('&search=renamed')).payments.map((payment) => payment.paymentId)).toEqual([posted.paymentId])
      expect((await list('&takenBy=me')).payments).toEqual([])
    } finally {
      await day.close()
    }
  })

  it('shows one receipt with its status and how often it was printed', async () => {
    const { paymentId, receipt } = await paidReceipt()
    const response = await get(asAccountant(), `/payments/${paymentId}`)
    expect(receiptSchema.parse(response.json())).toEqual({ ...receipt, printCount: 0 })
    expect(errorOf(await get(asAccountant(), `/payments/${randomUUID()}`))).toMatchObject({ status: 404, code: 'NOT_FOUND' })
  })
})

describe('reprints', () => {
  it('reprints a receipt any number of times, numbering each copy, and never changes the receipt', async () => {
    const { paymentId } = await paidReceipt()
    const before = await server.db.receipt.findUniqueOrThrow({ where: { paymentId } })
    expect((await printed(asAccountant(), paymentId, 'print')).text).toContain('Original')

    const second = await printed(asAccountant(), paymentId, 'reprint')
    expect(second.response.headers['content-type']).toBe('application/pdf')
    expect(second.text).toContain('Copy of original, print #2')
    expect(second.text).not.toContain('Original')
    server.advanceMinutes(5)
    const third = await printed(asAdmin(), paymentId, 'reprint')
    expect(third.text).toContain('Copy of original, print #3')

    expect(
      await server.db.receiptPrint.findMany({ where: { receipt: { paymentId } }, orderBy: { printNo: 'asc' } }),
    ).toMatchObject([
      { printNo: 1, computer: 2, printedById: accountant.id, allowanceId: null },
      { printNo: 2, computer: 2, printedById: accountant.id, allowanceId: null },
      { printNo: 3, computer: 1, printedById: admin.id, printedAt: server.now(), allowanceId: null },
    ])
    expect(await server.db.receipt.findUniqueOrThrow({ where: { paymentId } })).toEqual(before)
    expect(receiptSchema.parse((await get(asAccountant(), `/payments/${paymentId}`)).json()).printCount).toBe(3)
  })

  it('refuses a copy before the original has been printed', async () => {
    const { paymentId } = await paidReceipt()
    expect(errorOf(await post(asAccountant(), `/payments/${paymentId}/reprint`))).toMatchObject({
      status: 409,
      code: 'ORIGINAL_NOT_PRINTED',
    })
  })

  it('numbers two copies asked for at the same moment one after the other', async () => {
    const { paymentId } = await paidReceipt()
    await post(asAccountant(), `/payments/${paymentId}/print`)

    const answers = await Promise.all([
      post(asAccountant(), `/payments/${paymentId}/reprint`),
      post(asAdmin(), `/payments/${paymentId}/reprint`),
    ])
    expect(answers.map((response) => response.statusCode)).toEqual([200, 200])
    const numbers = await server.db.receiptPrint.findMany({ where: { receipt: { paymentId } }, select: { printNo: true } })
    expect(numbers.map((print) => print.printNo).toSorted()).toEqual([1, 2, 3])
  })
})

describe('one more original', () => {
  it('lets the Super Admin allow one more original after a failed print, with a reason, used once', async () => {
    const { paymentId } = await paidReceipt()
    await post(asAccountant(), `/payments/${paymentId}/print`)
    expect(errorOf(await post(asAccountant(), `/payments/${paymentId}/print`)).code).toBe('ALREADY_PRINTED')

    const allow = (as: Caller, body: object) => post(as, `/payments/${paymentId}/allow-original`, body)
    expect(errorOf(await allow(asAccountant(), { reason: 'Printer jammed' }))).toMatchObject({
      status: 403,
      code: 'NO_PERMISSION',
    })
    expect(errorOf(await allow(asAdmin(), { reason: ' ' }))).toMatchObject({ status: 400, code: 'VALIDATION_FAILED' })
    expect((await allow(asAdmin(), { reason: 'The printer jammed on the original.' })).statusCode).toBe(204)
    expect(errorOf(await allow(asAdmin(), { reason: 'Again' }))).toMatchObject({
      status: 409,
      code: 'ORIGINAL_ALREADY_ALLOWED',
    })

    const allowance = await server.db.originalPrintAllowance.findFirstOrThrow({ where: { receipt: { paymentId } } })
    expect(allowance).toMatchObject({ reason: 'The printer jammed on the original.', allowedById: admin.id })
    expect(await server.db.auditLog.findFirst({ where: { action: 'receipts.original_allowed', recordId: allowance.receiptId } })).toMatchObject(
      { userId: admin.id },
    )

    const again = await printed(asAccountant(), paymentId, 'print')
    expect(again.response.statusCode).toBe(200)
    expect(again.text).toContain('Original')
    expect(await server.db.receiptPrint.findFirst({ where: { allowanceId: allowance.id } })).toMatchObject({ printNo: 2 })
    expect(errorOf(await post(asAccountant(), `/payments/${paymentId}/print`)).code).toBe('ALREADY_PRINTED')

    // Each permission is its own, with its own reason and audit row, and the list counts them.
    expect((await allow(asAdmin(), { reason: 'Jammed again on the second original.' })).statusCode).toBe(204)
    const listed = paymentsListResponseSchema.parse((await get(asAdmin(), '/payments?date=2026-10-31')).json())
    expect(listed.payments.find((payment) => payment.paymentId === paymentId)).toMatchObject({ extraOriginalsAllowed: 2 })
    expect(await server.db.auditLog.count({ where: { action: 'receipts.original_allowed', recordId: allowance.receiptId } })).toBe(2)
  })

  it('has nothing to allow before the original has been printed', async () => {
    const { paymentId } = await paidReceipt()
    expect(errorOf(await post(asAdmin(), `/payments/${paymentId}/allow-original`, { reason: 'Printer jammed' }))).toMatchObject({
      status: 409,
      code: 'ORIGINAL_NOT_PRINTED',
    })
  })
})

describe('void requests', () => {
  it('records a request without changing the money, and refuses a second one', async () => {
    const { paymentId, receipt } = await paidReceipt()
    const cashBefore = await balance(server, school.cashId)

    const request = await requested(asAccountant(), paymentId)
    expect(request).toMatchObject({
      status: 'pending',
      reason: 'wrong_student',
      details: 'Wrong student selected.',
      requestedBy: 'Test Accountant',
      decidedAt: null,
      target: {
        type: 'payment',
        id: paymentId,
        receiptNo: receipt.snapshot.receiptNo,
        studentName: 'Bibek Lama',
        className: 'Class 7',
        sectionName: 'A',
        method: 'cash',
        amount: 355_000,
      },
    })
    expect(receiptSchema.parse((await get(asAccountant(), `/payments/${paymentId}`)).json()).status).toBe('void_requested')
    expect(await balance(server, school.cashId)).toBe(cashBefore)
    expect(await server.db.auditLog.findFirst({ where: { action: 'payments.void_requested', recordId: paymentId } })).not.toBeNull()

    expect(errorOf(await requestVoid(asAccountant(), paymentId))).toMatchObject({ status: 409, code: 'VOID_ALREADY_REQUESTED' })
    const mine = voidRequestsResponseSchema.parse((await get(asAccountant(), '/void-requests')).json())
    expect(mine.voidRequests.map((item) => item.id)).toContain(request.id)
    const pending = voidRequestsResponseSchema.parse((await get(asAdmin(), '/void-requests/pending')).json())
    expect(pending.voidRequests.map((item) => item.id)).toContain(request.id)
    expect(errorOf(await get(asAccountant(), '/void-requests/pending'))).toMatchObject({ status: 403, code: 'NO_PERMISSION' })
  })

  it('a rejected request can be requested again', async () => {
    const { paymentId } = await paidReceipt()
    const first = await requested(asAccountant(), paymentId)

    expect(errorOf(await post(asAdmin(), `/void-requests/${first.id}/decline`, {}))).toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
    })
    const declined = await post(asAdmin(), `/void-requests/${first.id}/decline`, { note: 'The guardian confirmed the student.' })
    expect(voidRequestSchema.parse(declined.json())).toMatchObject({
      status: 'declined',
      decidedBy: 'Test Super Admin',
      decisionNote: 'The guardian confirmed the student.',
    })
    expect(receiptSchema.parse((await get(asAccountant(), `/payments/${paymentId}`)).json()).status).toBe('posted')

    const second = await requested(asAccountant(), paymentId)
    expect(second.id).not.toBe(first.id)
    expect(second.status).toBe('pending')
  })

  it('says when the receipt does not exist or the details are missing', async () => {
    expect(errorOf(await requestVoid(asAccountant(), randomUUID()))).toMatchObject({ status: 404, code: 'NOT_FOUND' })
    const { paymentId } = await paidReceipt()
    expect(errorOf(await requestVoid(asAccountant(), paymentId, ' '))).toMatchObject({ status: 400, code: 'VALIDATION_FAILED' })
  })
})

describe('direct void', () => {
  it('lets the Super Admin void in one step, with a reason, kept as a direct request and a void', async () => {
    const { paymentId } = await paidReceipt()
    await post(asAccountant(), `/payments/${paymentId}/print`)

    const response = await post(asAdmin(), '/voids', {
      target: { type: 'payment', id: paymentId },
      reason: 'wrong_amount',
      details: 'The guardian paid twice by mistake.',
    })
    expect(response.statusCode, response.body).toBe(200)
    expect(voidRequestSchema.parse(response.json())).toMatchObject({
      status: 'approved',
      direct: true,
      requestedBy: 'Test Super Admin',
      decidedBy: 'Test Super Admin',
      details: 'The guardian paid twice by mistake.',
    })
    expect(await server.db.voidRecord.findUnique({ where: { paymentId } })).toMatchObject({ voidedById: admin.id })
    expect(await server.db.accountEntry.findMany({ where: { voidRecord: { paymentId } } })).toMatchObject([
      { direction: 'out', amountPaisa: 355_000n, entryDate: new Date('2026-10-31T00:00:00.000Z') },
    ])
    const audit = await server.db.auditLog.findFirst({ where: { action: 'payments.voided', recordId: paymentId } })
    expect(audit?.summary).toMatch(/^Voided directly by Test Super Admin: receipt /)
    expect((await printed(asAccountant(), paymentId, 'reprint')).text).toContain('VOID')
  })

  it('an Accountant calling the direct void route gets 403', async () => {
    const { paymentId } = await paidReceipt()
    const response = await post(asAccountant(), '/voids', {
      target: { type: 'payment', id: paymentId },
      reason: 'other',
      details: 'Not allowed.',
    })
    expect(errorOf(response)).toMatchObject({ status: 403, code: 'NO_PERMISSION' })
  })

  it('needs a reason, and waits while a request for the same receipt is open', async () => {
    const { paymentId } = await paidReceipt()
    const noReason = await post(asAdmin(), '/voids', { target: { type: 'payment', id: paymentId }, reason: 'other', details: ' ' })
    expect(errorOf(noReason)).toMatchObject({ status: 400, code: 'VALIDATION_FAILED' })

    await requested(asAccountant(), paymentId)
    const waiting = await post(asAdmin(), '/voids', { target: { type: 'payment', id: paymentId }, reason: 'other', details: 'Duplicate.' })
    expect(errorOf(waiting)).toEqual({
      status: 409,
      code: 'VOID_REQUEST_WAITING',
      message: 'A void request for this receipt is waiting. Approve or decline it first.',
    })
  })
})

describe('void approval', () => {
  it('an Accountant calling the approval route gets 403', async () => {
    const { paymentId } = await paidReceipt()
    const request = await requested(asAccountant(), paymentId)
    expect(errorOf(await post(asAccountant(), `/void-requests/${request.id}/approve`, {}))).toMatchObject({
      status: 403,
      code: 'NO_PERMISSION',
    })
    expect(errorOf(await post(asAccountant(), `/void-requests/${request.id}/decline`, { note: 'No' }))).toMatchObject({
      status: 403,
      code: 'NO_PERMISSION',
    })
  })

  it('a Super Admin cannot approve a void they asked for themselves', async () => {
    const { paymentId } = await paidReceipt()
    const request = await requested(asAdmin(), paymentId)
    expect(errorOf(await post(asAdmin(), `/void-requests/${request.id}/approve`, {}))).toMatchObject({
      status: 403,
      code: 'OWN_VOID_REQUEST',
    })
  })

  it('approving keeps the receipt number, takes the money back out today and reopens the dues and fines', async () => {
    // Paid one day, approved the next.
    const days = startTestServer()
    try {
      const accountantThen = { on: days, token: await signIn(days, accountant, COUNTER), ip: COUNTER }
      const { student, paymentId, receipt } = await paidReceipt(accountantThen, { fineOnAshwin: true })
      const request = await requested(accountantThen, paymentId)
      days.advanceMinutes(24 * 60)
      const adminNextDay = { on: days, token: await signIn(days, admin) }

      const response = await post(adminNextDay, `/void-requests/${request.id}/approve`, { note: 'Checked with the guardian.' })
      expect(voidRequestSchema.parse(response.json())).toMatchObject({
        status: 'approved',
        decidedBy: 'Test Super Admin',
        decisionNote: 'Checked with the guardian.',
      })
      expect(await days.db.voidRecord.findUnique({ where: { paymentId } })).toMatchObject({
        reason: 'wrong_student',
        note: 'Checked with the guardian.',
        voidRequestId: request.id,
        voidedById: admin.id,
      })
      expect(await days.db.accountEntry.findMany({ where: { voidRecord: { paymentId } } })).toMatchObject([
        {
          accountId: school.cashId,
          direction: 'out',
          amountPaisa: 720_000n,
          entryDate: new Date('2026-11-01T00:00:00.000Z'),
        },
      ])
      expect(await days.db.receipt.findUnique({ where: { paymentId } })).toMatchObject({
        receiptNo: receipt.snapshot.receiptNo,
      })
      expect(receiptSchema.parse((await get(adminNextDay, `/payments/${paymentId}`)).json()).status).toBe('voided')

      const dues = await get(adminNextDay, `/students/${student.id}/dues`)
      expect(studentDuesResponseSchema.parse(dues.json())).toMatchObject({
        items: [
          { kind: 'fee', periodLabel: 'Ashwin 2083', paid: 0, remaining: 355_000 },
          { kind: 'fine', reason: 'Late fine, Ashwin 2083', remaining: 10_000 },
          { kind: 'fee', periodLabel: 'Kartik 2083', paid: 0, remaining: 355_000 },
        ],
        total: 720_000,
      })
      expect(await days.db.feeDue.findMany({ where: { studentId: student.id } })).toMatchObject([
        { status: 'unpaid', version: 3 },
        { status: 'unpaid', version: 3 },
      ])
      expect(await days.db.auditLog.findFirst({ where: { action: 'payments.voided', recordId: paymentId } })).toMatchObject({
        userId: admin.id,
        computer: 1,
      })
      expect(
        errorOf(await requestVoid({ on: days, token: await signIn(days, accountant, COUNTER), ip: COUNTER }, paymentId)),
      ).toMatchObject({ status: 409, code: 'ALREADY_VOIDED' })
    } finally {
      await days.close()
    }
  })

  it('the cashbook total after approval equals the cashbook total before minus the receipt amount', async () => {
    const { paymentId } = await paidReceipt()
    const request = await requested(asAccountant(), paymentId)
    const before = await balance(server, school.cashId)

    expect((await post(asAdmin(), `/void-requests/${request.id}/approve`, {})).statusCode).toBe(200)
    expect(await balance(server, school.cashId)).toBe(before - 355_000n)
  })

  it('void approval twice at once gives one void', async () => {
    const { paymentId } = await paidReceipt()
    const request = await requested(asAccountant(), paymentId)

    const answers = await Promise.all([
      post(asAdmin(), `/void-requests/${request.id}/approve`, {}),
      post(asAdmin(), `/void-requests/${request.id}/approve`, {}),
    ])
    expect(answers.map((response) => response.statusCode).toSorted()).toEqual([200, 409])
    expect(await server.db.voidRecord.count({ where: { paymentId } })).toBe(1)
    expect(await server.db.accountEntry.count({ where: { voidRecord: { paymentId } } })).toBe(1)
  })

  it('lets only one decision through when approve and decline arrive at the same moment', async () => {
    const { paymentId } = await paidReceipt()
    const request = await requested(asAccountant(), paymentId)

    const answers = await Promise.all([
      post(asAdmin(), `/void-requests/${request.id}/approve`, {}),
      post(asAdmin(), `/void-requests/${request.id}/decline`, { note: 'Not needed after all.' }),
    ])
    expect(answers.map((response) => response.statusCode).toSorted()).toEqual([200, 409])
    const decided = await server.db.voidRequest.findUniqueOrThrow({ where: { id: request.id } })
    const voids = await server.db.voidRecord.count({ where: { paymentId } })
    expect(voids).toBe(decided.status === 'approved' ? 1 : 0)
  })

  it('a reprint after a void shows VOID', async () => {
    const { paymentId } = await paidReceipt()
    const original = await printed(asAccountant(), paymentId, 'print')
    expect(original.text).not.toContain('VOID')
    const request = await requested(asAccountant(), paymentId)
    expect((await post(asAdmin(), `/void-requests/${request.id}/approve`, {})).statusCode).toBe(200)

    const copy = await printed(asAccountant(), paymentId, 'reprint')
    expect(copy.response.statusCode).toBe(200)
    expect(copy.text).toContain('VOID')
    expect(copy.text).toContain('Copy of original, print #2')
  })
})
