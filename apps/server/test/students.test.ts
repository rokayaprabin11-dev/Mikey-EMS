import { randomUUID } from 'node:crypto'

import type { User } from '@mikey/db'
import {
  classesResponseSchema,
  collectPaymentResponseSchema,
  studentFeesSchema,
  type StudentSearchResponse,
  studentSearchResponseSchema,
} from '@mikey/shared'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { readLedger } from '../src/fees/ledger.ts'
import { outstandingByStudent } from '../src/fees/outstanding.ts'
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
const COUNTER = '192.168.1.83'

const server: TestServer = startTestServer()
let school: School
let admin: User
let accountant: User
let accountantToken: string
let adminToken: string
let classEight: { classId: string; sectionId: string }

beforeAll(async () => {
  school = await ensureSchool(server.db)
  admin = await createUser(server.db, 'super_admin')
  accountant = await createUser(server.db, 'accountant')
  await allowComputer(server.db, COUNTER, admin)
  const schoolClass = await server.db.schoolClass.upsert({
    where: { name: 'Class 8' },
    create: { name: 'Class 8', sortOrder: 10 },
    update: {},
  })
  const section = await server.db.section.upsert({
    where: { classId_name: { classId: schoolClass.id, name: 'A' } },
    create: { classId: schoolClass.id, name: 'A', sortOrder: 1 },
    update: {},
  })
  classEight = { classId: schoolClass.id, sectionId: section.id }
})

beforeEach(async () => {
  accountantToken = await signIn(server, accountant, COUNTER)
  adminToken = await signIn(server, admin)
})

afterAll(() => server.close())

function get(path: string) {
  return server.call({ method: 'GET', path, token: accountantToken, ip: COUNTER })
}

async function search(query: Record<string, string>): Promise<StudentSearchResponse['students']> {
  const response = await get(`/students?${new URLSearchParams(query).toString()}`)
  expect(response.statusCode, response.body).toBe(200)
  return studentSearchResponseSchema.parse(response.json()).students
}

// A student with a guardian phone of their own (createStudent gives every student the same one).
async function studentWithPhone(fullName: string, phone: string, sectionId = school.sectionId) {
  const { _max } = await server.db.studentEnrollment.aggregate({
    where: { sessionId: school.sessionId, sectionId },
    _max: { rollNo: true },
  })
  return server.db.student.create({
    data: {
      studentCode: `MEMS-2083-${randomUUID().slice(0, 4)}`,
      fullName,
      gender: 'female',
      dobDate: new Date('2015-01-10T00:00:00.000Z'),
      address: 'Banepa-7, Kavrepalanchok',
      admissionDate: new Date('2026-04-28T00:00:00.000Z'),
      enrollments: { create: { sessionId: school.sessionId, sectionId, rollNo: (_max.rollNo ?? 0) + 1 } },
      guardians: { create: { fullName: 'Mingmar Sherpa', relationship: 'Mother', phone } },
    },
    include: { enrollments: true },
  })
}

function pay(studentId: string, allocations: object[]) {
  return server.call({
    method: 'POST',
    path: '/payments',
    token: accountantToken,
    ip: COUNTER,
    body: { idempotencyKey: randomUUID(), studentId, method: 'cash', allocations },
  })
}

describe('student search', () => {
  it("a search for a guardian's phone number finds the student", async () => {
    const student = await studentWithPhone('Pema Yangzom Sherpa', '98411 52074')
    for (const typed of ['98411 52074', '9841152074', '98411', '984-115-2074']) {
      expect((await search({ q: typed })).map((found) => found.id), typed).toContain(student.id)
    }
    // Digits from the middle of the number are neither its start nor its end.
    expect((await search({ q: '1152' })).map((found) => found.id)).not.toContain(student.id)
  })

  it("a search by the last 4 digits of a guardian's phone finds the student, and fewer digits do not search phones", async () => {
    const student = await studentWithPhone('Lhakpa Doma Lama', '98033 47195')
    const ids = async (q: string) => (await search({ q })).map((found) => found.id)
    expect(await ids('7195')).toContain(student.id)
    expect(await ids('347195')).toContain(student.id)
    expect(await ids('195')).not.toContain(student.id)
    expect(await ids('9803')).toContain(student.id)
    expect(await ids('980')).not.toContain(student.id)
  })

  it('finds a student by the start of any word of their name or student ID, by roll number, and within a class', async () => {
    const student = await studentWithPhone('Ngawang Choden Lepcha', '98022 61390', classEight.sectionId)
    const [enrollment] = student.enrollments
    const ids = async (query: Record<string, string>) => (await search(query)).map((found) => found.id)

    expect(await ids({ q: 'choden' })).toContain(student.id)
    expect(await ids({ q: 'NGA lep' })).toContain(student.id)
    expect(await ids({ q: 'hoden' })).not.toContain(student.id)
    const [, , idPart] = student.studentCode.split('-')
    expect(await ids({ q: `2083-${idPart ?? ''}` })).toContain(student.id)
    expect(await ids({ q: String(enrollment?.rollNo), classId: classEight.classId })).toContain(student.id)

    const inClassEight = await search({ classId: classEight.classId })
    expect(inClassEight.map((found) => found.id)).toContain(student.id)
    expect(inClassEight.every((found) => found.className === 'Class 8')).toBe(true)
    expect(await ids({ q: 'choden', classId: (await server.db.section.findUniqueOrThrow({ where: { id: school.sectionId } })).classId })).toEqual([])
  })

  it('returns at most 20 students, sorted by name', async () => {
    for (let index = 0; index < 23; index += 1) {
      await createStudent(server.db, school, `Ranjana Twentylimit ${String.fromCharCode(97 + index)}`)
    }
    const found = await search({ q: 'twentylimit' })
    expect(found).toHaveLength(20)
    const names = found.map((student) => student.fullName)
    expect(names).toEqual([...names].sort())
    expect(names[0]).toBe('Ranjana Twentylimit a')
  })

  it('shows what each student owes, and only students with dues when asked', async () => {
    const owing = await createStudent(server.db, school, 'Asha Duecheck')
    const paidUp = await createStudent(server.db, school, 'Bina Duecheck')
    await addDue(server.db, school, owing.id, { month: 7, rupees: 3550 })
    const due = await addDue(server.db, school, paidUp.id, { month: 7, rupees: 3550 })
    expect((await pay(paidUp.id, [{ kind: 'fee', feeDueId: due.id, amount: 355_000 }])).statusCode).toBe(200)

    const both = await search({ q: 'duecheck' })
    expect(both.map((student) => [student.fullName, student.outstanding])).toEqual([
      ['Asha Duecheck', 355_000],
      ['Bina Duecheck', 0],
    ])
    expect((await search({ q: 'duecheck', withDues: 'true' })).map((student) => student.fullName)).toEqual(['Asha Duecheck'])
  })

  it('gives the Accountant the fields of the lookup screen and nothing more', async () => {
    await studentWithPhone('Dawa Fieldcheck', '98133 70215')
    const [found] = await search({ q: 'fieldcheck' })
    expect(Object.keys(found ?? {}).sort()).toEqual(
      ['className', 'code', 'fullName', 'guardianName', 'guardianPhone', 'id', 'outstanding', 'rollNo', 'sectionName', 'status'].sort(),
    )
    expect(found).toMatchObject({ guardianName: 'Mingmar Sherpa', guardianPhone: '98133 70215', status: 'active' })
    const detail = studentFeesSchema.parse((await get(`/students/${found?.id ?? ''}/fees`)).json())
    expect(Object.keys(detail.student).sort()).toEqual(
      ['className', 'code', 'fullName', 'guardianName', 'guardianPhone', 'guardianRelationship', 'id', 'outstanding', 'rollNo', 'sectionName', 'status'].sort(),
    )
  })

  it('lists the classes with their sections in order', async () => {
    const response = await server.call({ method: 'GET', path: '/classes', token: adminToken })
    const { classes } = classesResponseSchema.parse(response.json())
    const names = classes.map((item) => item.name)
    expect(names.indexOf('Class 7')).toBeLessThan(names.indexOf('Class 8'))
    expect(classes.find((item) => item.name === 'Class 8')?.sections.map((section) => section.name)).toEqual(['A'])
  })
})

describe('one student on the lookup screen', () => {
  it('shows their dues, what they paid this session and every receipt as it was printed', async () => {
    const student = await createStudent(server.db, school, 'Sonam Detailcheck')
    const ashwin = await addDue(server.db, school, student.id, { month: 6, rupees: 3550 })
    const kartik = await addDue(server.db, school, student.id, { month: 7, rupees: 3550 })
    const paid = await pay(student.id, [{ kind: 'fee', feeDueId: ashwin.id, amount: 355_000 }])
    const { receipt } = collectPaymentResponseSchema.parse(paid.json())
    server.advanceMinutes(1)
    const part = await pay(student.id, [{ kind: 'fee', feeDueId: kartik.id, amount: 100_000 }])
    const { receipt: partReceipt } = collectPaymentResponseSchema.parse(part.json())
    const asked = await server.call({
      method: 'POST',
      path: '/void-requests',
      token: accountantToken,
      ip: COUNTER,
      body: { target: { type: 'payment', id: partReceipt.paymentId }, reason: 'wrong_amount', details: 'Typed the wrong amount.' },
    })
    const request = asked.json<{ id: string }>()
    expect((await server.call({ method: 'POST', path: `/void-requests/${request.id}/approve`, token: adminToken, body: {} })).statusCode).toBe(200)

    const detail = studentFeesSchema.parse((await get(`/students/${student.id}/fees`)).json())
    expect(detail.student).toMatchObject({ fullName: 'Sonam Detailcheck', guardianRelationship: 'Father', outstanding: 355_000 })
    expect(detail.dues.map((item) => [item.kind, item.periodLabel, item.remaining])).toEqual([['fee', 'Kartik 2083', 355_000]])
    expect(detail.paidThisSession).toEqual({ sessionName: '2083', since: '2026-04-28', amount: 355_000, receiptCount: 1 })
    expect(detail.payments.map((payment) => [payment.receiptNo, payment.status, payment.amount])).toEqual([
      [partReceipt.snapshot.receiptNo, 'voided', 100_000],
      [receipt.snapshot.receiptNo, 'posted', 355_000],
    ])
    expect(detail.payments[1]?.lines).toEqual(receipt.snapshot.lines)
  })

  it('says when the student does not exist', async () => {
    expect(errorOf(await get(`/students/${randomUUID()}/fees`))).toMatchObject({ status: 404, code: 'NOT_FOUND' })
  })
})

describe('what students owe, for many students at once', () => {
  it('agrees with the ledger for part payments, discounts, fines, waived fines, cancelled dues and voided payments', async () => {
    const students = [
      await createStudent(server.db, school, 'Ledger Partpaid'),
      await createStudent(server.db, school, 'Ledger Discount'),
      await createStudent(server.db, school, 'Ledger Fines'),
      await createStudent(server.db, school, 'Ledger Cancelled'),
      await createStudent(server.db, school, 'Ledger Voided'),
      await createStudent(server.db, school, 'Ledger Nothing'),
    ]
    const [partPaid, discount, fines, cancelled, voided] = students.map((student) => student.id) as [string, string, string, string, string]
    const partDue = await addDue(server.db, school, partPaid, { month: 7, rupees: 3550 })
    expect((await pay(partPaid, [{ kind: 'fee', feeDueId: partDue.id, amount: 150_000 }])).statusCode).toBe(200)
    await addDue(server.db, school, discount, { month: 7, rupees: 3550, discountRupees: 550 })
    const finedDue = await addDue(server.db, school, fines, { month: 6, rupees: 3550 })
    await addFine(server.db, finedDue.id, 100)
    const waived = await addFine(server.db, finedDue.id, 50, 'Second late fine')
    await server.db.fine.update({ where: { id: waived.id }, data: { waivedAt: new Date(), waivedById: admin.id } })
    const dropped = await addDue(server.db, school, cancelled, { month: 7, rupees: 3550 })
    await server.db.feeDue.update({ where: { id: dropped.id }, data: { status: 'cancelled' } })
    await addDue(server.db, school, cancelled, { month: 8, rupees: 3550 })
    const voidedDue = await addDue(server.db, school, voided, { month: 7, rupees: 3550 })
    const payment = collectPaymentResponseSchema.parse((await pay(voided, [{ kind: 'fee', feeDueId: voidedDue.id, amount: 355_000 }])).json())
    await server.call({
      method: 'POST',
      path: '/voids',
      token: adminToken,
      body: { target: { type: 'payment', id: payment.receipt.paymentId }, reason: 'wrong_student', details: 'Wrong student.' },
    })

    const owed = await outstandingByStudent(
      server.db,
      students.map((student) => student.id),
    )
    for (const student of students) {
      const ledger = await readLedger(server.db, student.id)
      expect(owed.get(student.id) ?? 0n, student.fullName).toBe(ledger.outstanding)
    }
    // Rs. 3,550 less 1,500 paid; less a 550 discount; plus a 100 fine (the 50 one is waived); only
    // the due not cancelled; the voided payment's due is owed again; nothing at all.
    expect(students.map((student) => owed.get(student.id) ?? 0n)).toEqual([205_000n, 300_000n, 365_000n, 355_000n, 355_000n, 0n])
    expect(owed.has(students[5]?.id ?? '')).toBe(false)
  })
})
