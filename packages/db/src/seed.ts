import { randomUUID } from 'node:crypto'
import { hostname, networkInterfaces } from 'node:os'

import {
  ACCOUNTANT_DEFAULT_PERMISSIONS,
  type AdDate,
  adToBs,
  bsMonthName,
  bsToAd,
  buildReceiptSnapshot,
  daysInBsMonth,
  fiscalYearOf,
  kathmanduDate,
  parseBsDate,
  PERMISSION_KEYS,
  type ReceiptLineInput,
  toPaisaNumber,
} from '@mikey/shared'
import { hash } from '@node-rs/argon2'

import { createDb, type PaymentMethod, type Prisma } from './index.ts'

// Development sample data. It refuses to run unless MIKEY_ALLOW_DEV_SEED=yes and the database is
// empty, and it only ever inserts rows: it never switches a trigger off.

const SESSION = 2083
const DEV_PASSWORD = 'mikey-dev-2083'
const CASH_FLOAT_RUPEES = 20_000
const SCHOOL_PROFILE = { name: 'Mikey English Medium School', address: null, phone: null, email: null, pan: null }
const FINE_REASON = 'Late fine, Ashwin 2083'

if (process.env.MIKEY_ALLOW_DEV_SEED !== 'yes') {
  throw new Error('The sample school is for development only. Set MIKEY_ALLOW_DEV_SEED=yes in apps/server/.env to load it.')
}
const databaseUrl = process.env.DATABASE_URL
if (databaseUrl === undefined) {
  throw new Error('DATABASE_URL is not set. Copy apps/server/.env.example to apps/server/.env.')
}

const today = kathmanduDate(new Date())
if (today < '2026-10-31') {
  throw new Error('The sample school assumes today is 14 Kartik 2083 (31 Oct 2026) or later.')
}
const todayBs = adToBs(today)
const billedThrough = todayBs.year > SESSION ? 12 : todayBs.month

function bs(month: number, day: number): AdDate {
  return bsToAd({ year: SESSION, month, day })
}

function asDate(ad: AdDate): Date {
  return new Date(`${ad}T00:00:00.000Z`)
}

function at(ad: AdDate, time: string): Date {
  return new Date(`${ad}T${time}:00+05:45`)
}

function rupees(amount: number): bigint {
  return BigInt(amount) * 100n
}

function minute(base: number, offset: number): string {
  const total = base + offset
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

function previousSchoolDay(ad: AdDate): AdDate {
  const day = new Date(`${ad}T00:00:00.000Z`)
  do {
    day.setUTCDate(day.getUTCDate() - 1)
  } while (day.getUTCDay() === 6)
  return day.toISOString().slice(0, 10)
}

const CLASSES: readonly (readonly [string, number])[] = [
  ['Play Group', 2400],
  ['Nursery', 2500],
  ['LKG', 2600],
  ['UKG', 2700],
  ['Class 1', 2900],
  ['Class 2', 3030],
  ['Class 3', 3160],
  ['Class 4', 3290],
  ['Class 5', 3400],
  ['Class 6', 3550],
  ['Class 7', 3680],
  ['Class 8', 3810],
  ['Class 9', 3900],
  ['Class 10', 4200],
]

type Plan =
  | 'paid_to_ashwin'
  | 'kartik_today'
  | 'kartik_earlier'
  | 'part_ashwin_today'
  | 'owes_two_months'
  | 'new_admission'
  | 'voided_today'
  | 'void_requested_today'

interface KartikVisit {
  day: number | 'today'
  time: string
  method: PaymentMethod
  reference?: string
  by: 'sarita' | 'bikash'
}

interface StudentSeed {
  code: string
  name: string
  gender: 'female' | 'male'
  className: string
  section: 'A' | 'B'
  roll: number
  admitted: string
  guardian: readonly [name: string, relationship: string, phone: string]
  plan: Plan
  kartik?: KartikVisit
}

const STUDENTS: readonly StudentSeed[] = [
  { code: 'MEMS-2078-0141', name: 'Aarav Shrestha', gender: 'male', className: 'Class 5', section: 'B', roll: 12, admitted: '2078-01-03', guardian: ['Rajesh Shrestha', 'Father', '98510 42317'], plan: 'kartik_today', kartik: { day: 'today', time: '10:52', method: 'cash', by: 'bikash' } },
  { code: 'MEMS-2073-0022', name: 'Anisha Maharjan', gender: 'female', className: 'Class 10', section: 'A', roll: 3, admitted: '2073-01-02', guardian: ['Sunita Maharjan', 'Mother', '98411 70563'], plan: 'kartik_today', kartik: { day: 'today', time: '10:24', method: 'bank_deposit', reference: 'DEP-551208', by: 'bikash' } },
  { code: 'MEMS-2076-0098', name: 'Bibek Lama', gender: 'male', className: 'Class 7', section: 'A', roll: 17, admitted: '2076-01-05', guardian: ['Pasang Lama', 'Father', '98600 12884'], plan: 'part_ashwin_today' },
  { code: 'MEMS-2079-0203', name: 'Dipesh Karki', gender: 'male', className: 'Class 4', section: 'A', roll: 8, admitted: '2079-01-02', guardian: ['Kamala Karki', 'Mother', '98010 55621'], plan: 'paid_to_ashwin' },
  { code: 'MEMS-2081-0310', name: 'Kritika Ghimire', gender: 'female', className: 'Class 2', section: 'B', roll: 21, admitted: '2081-01-15', guardian: ['Hari Ghimire', 'Father', '98415 30982'], plan: 'owes_two_months' },
  { code: 'MEMS-2083-0712', name: 'Nisha Dahal', gender: 'female', className: 'LKG', section: 'A', roll: 26, admitted: '2083-07-08', guardian: ['Ramesh Dahal', 'Father', '98132 67410'], plan: 'new_admission' },
  { code: 'MEMS-2081-0335', name: 'Prakriti Karki', gender: 'female', className: 'UKG', section: 'A', roll: 9, admitted: '2081-01-15', guardian: ['Bimala Karki', 'Mother', '98495 11206'], plan: 'kartik_today', kartik: { day: 'today', time: '10:39', method: 'cash', by: 'sarita' } },
  { code: 'MEMS-2083-0709', name: 'Samir Thapa', gender: 'male', className: 'Class 3', section: 'B', roll: 30, admitted: '2083-07-10', guardian: ['Gita Thapa', 'Mother', '98610 74523'], plan: 'new_admission' },
  { code: 'MEMS-2075-0064', name: 'Srijana Nakarmi', gender: 'female', className: 'Class 8', section: 'A', roll: 14, admitted: '2075-01-02', guardian: ['Bishnu Nakarmi', 'Father', '98510 88014'], plan: 'owes_two_months' },
  { code: 'MEMS-2074-0047', name: 'Sujata Tamang', gender: 'female', className: 'Class 9', section: 'A', roll: 22, admitted: '2074-01-02', guardian: ['Dawa Tamang', 'Uncle', '98411 20476'], plan: 'kartik_today', kartik: { day: 'today', time: '10:47', method: 'fonepay', reference: 'FP-7Q2K9M', by: 'bikash' } },
  { code: 'MEMS-2077-0150', name: 'Kiran Ghimire', gender: 'male', className: 'Class 6', section: 'A', roll: 9, admitted: '2077-01-03', guardian: ['Hari Ghimire', 'Father', '98415 30982'], plan: 'void_requested_today' },
  { code: 'MEMS-2079-0188', name: 'Rohan Adhikari', gender: 'male', className: 'Class 4', section: 'A', roll: 2, admitted: '2079-01-02', guardian: ['Sita Adhikari', 'Mother', '98510 66231'], plan: 'voided_today' },
  { code: 'MEMS-2080-0251', name: 'Pemba Lama', gender: 'male', className: 'Class 3', section: 'A', roll: 22, admitted: '2080-01-03', guardian: ['Nima Lama', 'Father', '98600 44120'], plan: 'kartik_earlier', kartik: { day: 6, time: '11:05', method: 'khalti', reference: 'KH-20831106', by: 'bikash' } },
  { code: 'MEMS-2082-0402', name: 'Sonam Lama', gender: 'female', className: 'UKG', section: 'A', roll: 5, admitted: '2082-01-15', guardian: ['Dolma Lama', 'Mother', '98411 90316'], plan: 'paid_to_ashwin' },
  { code: 'MEMS-2074-0051', name: 'Tashi Lama', gender: 'male', className: 'Class 9', section: 'A', roll: 11, admitted: '2074-01-02', guardian: ['Karma Lama', 'Father', '98010 22874'], plan: 'kartik_earlier', kartik: { day: 3, time: '12:10', method: 'cheque', reference: 'Cheque 004512, [Bank name]', by: 'sarita' } },
  { code: 'MEMS-2082-0415', name: 'Yangchen Lama', gender: 'female', className: 'Class 1', section: 'B', roll: 30, admitted: '2082-01-15', guardian: ['Pema Lama', 'Mother', '98132 50917'], plan: 'paid_to_ashwin' },
  { code: 'MEMS-2076-0102', name: 'Kabita Rai', gender: 'female', className: 'Class 7', section: 'A', roll: 14, admitted: '2076-01-05', guardian: ['Sabitri Rai', 'Mother', '98495 33018'], plan: 'kartik_earlier', kartik: { day: 2, time: '09:40', method: 'cash', by: 'bikash' } },
  { code: 'MEMS-2076-0104', name: 'Kiran Bista', gender: 'male', className: 'Class 7', section: 'A', roll: 15, admitted: '2076-01-05', guardian: ['Ganesh Bista', 'Father', '98510 70112'], plan: 'paid_to_ashwin' },
  { code: 'MEMS-2076-0107', name: 'Laxmi Pradhan', gender: 'female', className: 'Class 7', section: 'A', roll: 16, admitted: '2076-01-05', guardian: ['Rita Pradhan', 'Mother', '98411 64205'], plan: 'owes_two_months' },
  { code: 'MEMS-2076-0110', name: 'Manish Dangol', gender: 'male', className: 'Class 7', section: 'A', roll: 18, admitted: '2076-01-05', guardian: ['Suresh Dangol', 'Father', '98600 81733'], plan: 'paid_to_ashwin' },
  { code: 'MEMS-2076-0112', name: 'Nabin K.C.', gender: 'male', className: 'Class 7', section: 'A', roll: 19, admitted: '2076-01-05', guardian: ['Bimal K.C.', 'Father', '98010 39450'], plan: 'kartik_earlier', kartik: { day: 4, time: '10:15', method: 'esewa', reference: 'ESW-91C4D7', by: 'bikash' } },
  { code: 'MEMS-2076-0115', name: 'Rina Gurung', gender: 'female', className: 'Class 7', section: 'A', roll: 20, admitted: '2076-01-05', guardian: ['Maya Gurung', 'Mother', '98132 27764'], plan: 'paid_to_ashwin' },
  { code: 'MEMS-2076-0118', name: 'Roshan Shahi', gender: 'male', className: 'Class 7', section: 'A', roll: 21, admitted: '2076-01-05', guardian: ['Prem Shahi', 'Father', '98495 58821'], plan: 'paid_to_ashwin' },
]

const EXPENSES = [
  { day: 'today', time: '09:15', description: 'Electricity bill', category: 'Utilities', account: 'bank', voucher: 'NEA-8841', amount: 5200 },
  { day: 'today', time: '10:05', description: 'Whiteboard markers and chalk', category: 'Stationery and teaching', account: 'cash', voucher: 'V-214', amount: 1450 },
  { day: 'today', time: '10:20', description: 'School bus diesel top-up', category: 'Transport and fuel', account: 'cash', voucher: 'V-215', amount: 800 },
  { day: 11, time: '13:30', description: 'Internet, monthly', category: 'Utilities', account: 'bank', voucher: 'ISP-1102', amount: 2600 },
  { day: 10, time: '14:10', description: 'Football and volleyball', category: 'Events and sports', account: 'cash', voucher: 'V-209', amount: 6400 },
  { day: 9, time: '12:45', description: 'Plumber, ground floor tap', category: 'Repairs and maintenance', account: 'cash', voucher: 'V-206', amount: 1750 },
  { day: 8, time: '11:20', description: '40 desks and benches for Class 1', category: 'Furniture', account: 'bank', voucher: 'BILL-3307', amount: 150_000 },
] as const

interface DueRow {
  id: string
  studentId: string
  headId: string
  periodLabel: string
  billDate: AdDate
  dueDate: AdDate
  amount: bigint
  paid: bigint
}

interface PlannedPayment {
  id: string
  studentId: string
  paidDate: AdDate
  at: Date
  method: PaymentMethod
  reference: string | null
  takenBy: 'sarita' | 'bikash'
  allocations: { dueId?: string; fineId?: string; amount: bigint }[]
  voided?: true
}

async function main(url: string): Promise<void> {
  const db = createDb(url)
  try {
    if ((await db.user.count()) > 0) {
      throw new Error('This database already has users, so the sample school was not loaded. Use an empty development database.')
    }

    const id = {
      superAdminRole: randomUUID(),
      accountantRole: randomUUID(),
      sarita: randomUUID(),
      bikash: randomUUID(),
      puja: randomUUID(),
      session: randomUUID(),
      cash: randomUUID(),
      bank: randomUUID(),
      admission: randomUUID(),
      tuition: randomUUID(),
      annual: randomUUID(),
      exam: randomUUID(),
      device: randomUUID(),
    }
    const users = {
      sarita: { id: id.sarita, computer: 1 as const, fullName: 'Sarita Shrestha' },
      bikash: { id: id.bikash, computer: 2 as const, fullName: 'Bikash Maharjan' },
    }
    const feeHeads = [
      { id: id.admission, name: 'Admission', kind: 'once' },
      { id: id.tuition, name: 'Monthly tuition', kind: 'monthly', countsAsTuition: true },
      { id: id.annual, name: 'Annual', kind: 'annual' },
      { id: id.exam, name: 'Exam', kind: 'per_exam' },
    ] as const
    const passwordHash = await hash(DEV_PASSWORD)
    const sessionStart = bs(1, 15)

    const classIds = new Map(CLASSES.map(([name]) => [name, randomUUID()]))
    const sectionIds = new Map<string, string>()
    for (const [name] of CLASSES) {
      for (const section of ['A', 'B']) {
        sectionIds.set(`${name} ${section}`, randomUUID())
      }
    }
    const tuitionOf = new Map(CLASSES.map(([name, tuition]) => [name, tuition]))

    const dues: DueRow[] = []
    const fines: { id: string; dueId: string; amount: bigint; paid: bigint; createdAt: Date }[] = []
    const payments: PlannedPayment[] = []
    const voidRequests: Prisma.VoidRequestCreateManyInput[] = []
    const voids: Prisma.VoidRecordCreateManyInput[] = []
    const studentRows: Prisma.StudentCreateManyInput[] = []
    const enrollmentRows: Prisma.StudentEnrollmentCreateManyInput[] = []
    const guardianRows: Prisma.GuardianCreateManyInput[] = []
    const receiptStudents = new Map<string, Parameters<typeof buildReceiptSnapshot>[0]['student']>()

    function addDue(studentId: string, headId: string, periodLabel: string, billDate: AdDate, dueDate: AdDate, amount: number): DueRow {
      const row = { id: randomUUID(), studentId, headId, periodLabel, billDate, dueDate, amount: rupees(amount), paid: 0n }
      dues.push(row)
      return row
    }

    function pay(payment: Omit<PlannedPayment, 'id' | 'allocations'>, items: (DueRow | { fine: (typeof fines)[number] })[], partial?: bigint): PlannedPayment {
      const planned: PlannedPayment = { ...payment, id: randomUUID(), allocations: [] }
      for (const item of items) {
        if ('fine' in item) {
          const amount = item.fine.amount - item.fine.paid
          planned.allocations.push({ fineId: item.fine.id, amount })
          if (!payment.voided) item.fine.paid += amount
        } else {
          const amount = partial ?? item.amount - item.paid
          planned.allocations.push({ dueId: item.id, amount })
          if (!payment.voided) item.paid += amount
        }
      }
      payments.push(planned)
      return planned
    }

    STUDENTS.forEach((student, index) => {
      const studentId = randomUUID()
      const classIndex = CLASSES.findIndex(([name]) => name === student.className)
      const tuition = tuitionOf.get(student.className)
      const sectionId = sectionIds.get(`${student.className} ${student.section}`)
      if (classIndex < 0 || tuition === undefined || sectionId === undefined) {
        throw new Error(`Unknown class for ${student.name}.`)
      }
      const admittedAd = bsToAd(parseBsDate(student.admitted))
      studentRows.push({
        id: studentId,
        studentCode: student.code,
        fullName: student.name,
        gender: student.gender,
        dobDate: asDate(bsToAd({ year: SESSION - 3 - classIndex, month: (index % 12) + 1, day: 10 })),
        address: `Banepa-${(index % 14) + 1}, Kavrepalanchok`,
        admissionDate: asDate(admittedAd),
      })
      enrollmentRows.push({ id: randomUUID(), studentId, sessionId: id.session, sectionId, rollNo: student.roll })
      const [guardianName, relationship, phone] = student.guardian
      guardianRows.push({ id: randomUUID(), studentId, fullName: guardianName, relationship, phone })
      receiptStudents.set(studentId, {
        code: student.code,
        fullName: student.name,
        className: student.className,
        sectionName: student.section,
        rollNo: student.roll,
        guardianName,
      })

      const isNew = student.plan === 'new_admission'
      const firstMonth = isNew ? adToBs(admittedAd).month : 1
      const monthly = new Map<number, DueRow>()
      for (let month = firstMonth; month <= billedThrough; month += 1) {
        monthly.set(month, addDue(studentId, id.tuition, `${bsMonthName(month)} ${SESSION}`, bs(month, 1), bs(month, 15), tuition))
      }
      if (isNew) {
        addDue(studentId, id.admission, `${SESSION}`, admittedAd, admittedAd, tuition)
        return
      }
      const annual = addDue(studentId, id.annual, `${SESSION}`, sessionStart, bs(1, 30), tuition * 2)
      const exam = billedThrough >= 4 ? addDue(studentId, id.exam, `First term ${SESSION}`, bs(4, 1), bs(4, 15), tuition / 2) : undefined

      const time = minute(9 * 60 + 30, index)
      const historyBy = (month: number): 'sarita' | 'bikash' => ((index + month) % 3 === 0 ? 'sarita' : 'bikash')
      const historyMethod = (month: number): { method: PaymentMethod; reference: string | null } => {
        if ((index + month) % 5 === 0) return { method: 'fonepay', reference: `FP-${student.roll}${month}${index}` }
        if ((index + month) % 7 === 0) return { method: 'bank_deposit', reference: `DEP-${student.roll}${month}${index}` }
        return { method: 'cash', reference: null }
      }
      const visit = (month: number, day: number, items: (DueRow | undefined)[]) => {
        const paid = items.filter((item): item is DueRow => item !== undefined)
        pay({ studentId, paidDate: bs(month, day), at: at(bs(month, day), time), takenBy: historyBy(month), ...historyMethod(month) }, paid)
      }

      const skipsAshwin = student.plan === 'owes_two_months' || student.plan === 'part_ashwin_today'
      for (let month = 1; month <= Math.min(billedThrough, 6); month += 1) {
        const tuitionDue = monthly.get(month)
        if (month === 1) visit(1, 20, [annual, tuitionDue])
        else if (month === 4) visit(4, 5 + (index % 7), [tuitionDue, exam])
        else if (month === 6 && skipsAshwin) continue
        else if (month === 6 && student.plan === 'voided_today') visit(6, 20, [tuitionDue])
        else visit(month, 5 + (index % 7), [tuitionDue])
      }

      const ashwin = monthly.get(6)
      const kartik = monthly.get(7)
      const lateFine = (): (typeof fines)[number] => {
        if (ashwin === undefined) throw new Error('Ashwin was not billed.')
        const fine = { id: randomUUID(), dueId: ashwin.id, amount: rupees(100), paid: 0n, createdAt: at(bs(6, 16), '10:00') }
        fines.push(fine)
        return fine
      }
      if (student.plan === 'owes_two_months') lateFine()
      if (kartik === undefined || ashwin === undefined) return

      if (student.kartik !== undefined) {
        const visitDay = student.kartik.day === 'today' ? today : bs(7, student.kartik.day)
        pay(
          {
            studentId,
            paidDate: visitDay,
            at: at(visitDay, student.kartik.time),
            method: student.kartik.method,
            reference: student.kartik.reference ?? null,
            takenBy: student.kartik.by,
          },
          [kartik],
        )
      }
      if (student.plan === 'part_ashwin_today') {
        lateFine()
        pay({ studentId, paidDate: today, at: at(today, '10:31'), method: 'cash', reference: null, takenBy: 'bikash' }, [ashwin], rupees(2000))
      }
      if (student.plan === 'void_requested_today') {
        const payment = pay({ studentId, paidDate: today, at: at(today, '09:47'), method: 'cash', reference: null, takenBy: 'bikash' }, [kartik])
        voidRequests.push({
          id: randomUUID(),
          paymentId: payment.id,
          reason: 'wrong_student',
          details: 'Wrong student selected. The money was for his sister Kritika Ghimire, Class 2 B.',
          requestedById: id.bikash,
          requestedAt: at(today, '10:12'),
        })
      }
      if (student.plan === 'voided_today') {
        const fine = lateFine()
        const wrong = pay({ studentId, paidDate: today, at: at(today, '09:31'), method: 'cash', reference: null, takenBy: 'bikash', voided: true }, [kartik])
        const requestId = randomUUID()
        voidRequests.push({
          id: requestId,
          paymentId: wrong.id,
          reason: 'wrong_amount',
          details: 'The guardian also paid the Ashwin late fine. One receipt should cover both.',
          status: 'approved',
          requestedById: id.bikash,
          requestedAt: at(today, '09:32'),
          decidedById: id.sarita,
          decidedAt: at(today, '09:33'),
          decisionNote: 'Checked with the guardian.',
        })
        voids.push({ id: randomUUID(), paymentId: wrong.id, reason: 'wrong_amount', voidRequestId: requestId, voidedById: id.sarita, voidedAt: at(today, '09:33') })
        pay({ studentId, paidDate: today, at: at(today, '09:34'), method: 'cash', reference: null, takenBy: 'bikash' }, [kartik, { fine }])
      }
    })

    payments.sort((a, b) => a.at.getTime() - b.at.getTime())

    // Each receipt prints what the student owed at that moment: the dues billed by then, less the
    // money taken before it by payments that had not been voided by then.
    const voidedAt = new Map<string, Date>()
    for (const row of voids) {
      if (typeof row.paymentId === 'string' && row.voidedAt instanceof Date) voidedAt.set(row.paymentId, row.voidedAt)
    }
    const dueById = new Map(dues.map((due) => [due.id, due]))
    const headById = new Map<string, (typeof feeHeads)[number]>(feeHeads.map((head) => [head.id, head]))
    const countsAt = (payment: PlannedPayment, moment: Date): boolean => {
      const voided = voidedAt.get(payment.id)
      return payment.at < moment && (voided === undefined || voided > moment)
    }
    const paidBefore = (payment: PlannedPayment, target: { dueId?: string; fineId?: string }): bigint =>
      payments
        .filter((other) => other.studentId === payment.studentId && countsAt(other, payment.at))
        .flatMap((other) => other.allocations)
        .filter((item) => (target.dueId === undefined ? item.fineId === target.fineId : item.dueId === target.dueId))
        .reduce((sum, item) => sum + item.amount, 0n)
    const owedBefore = (payment: PlannedPayment): bigint => {
      const billed = dues.filter((due) => due.studentId === payment.studentId && due.billDate <= payment.paidDate)
      const fined = fines.filter((fine) => dueById.get(fine.dueId)?.studentId === payment.studentId && fine.createdAt <= payment.at)
      return (
        billed.reduce((sum, due) => sum + due.amount - paidBefore(payment, { dueId: due.id }), 0n) +
        fined.reduce((sum, fine) => sum + fine.amount - paidBefore(payment, { fineId: fine.id }), 0n)
      )
    }
    const receiptLines = (payment: PlannedPayment): ReceiptLineInput[] =>
      payment.allocations.map((item) => {
        if (item.fineId !== undefined) {
          return { kind: 'fine', reason: FINE_REASON, amount: toPaisaNumber(item.amount) }
        }
        const due = item.dueId === undefined ? undefined : dueById.get(item.dueId)
        const head = due === undefined ? undefined : headById.get(due.headId)
        if (due === undefined || head === undefined) throw new Error('A payment points at no due.')
        const before = paidBefore(payment, { dueId: due.id })
        return {
          kind: 'fee',
          headName: head.name,
          monthly: head.kind === 'monthly',
          periodLabel: due.periodLabel,
          billDate: due.billDate,
          amount: toPaisaNumber(item.amount),
          wasPartPaid: before > 0n,
          clearsDue: before + item.amount === due.amount,
        }
      })

    const counters = new Map<string, number>()
    const receiptRows: Prisma.ReceiptCreateManyInput[] = []
    const printRows: Prisma.ReceiptPrintCreateManyInput[] = []
    for (const payment of payments) {
      const fiscalYear = fiscalYearOf(adToBs(payment.paidDate))
      const seq = (counters.get(fiscalYear) ?? 0) + 1
      counters.set(fiscalYear, seq)
      const receiptNo = `${fiscalYear}-${String(seq).padStart(6, '0')}`
      const amount = payment.allocations.reduce((sum, item) => sum + item.amount, 0n)
      const duesBefore = owedBefore(payment)
      const student = receiptStudents.get(payment.studentId)
      if (student === undefined) throw new Error('A payment points at no student.')
      const receiptId = randomUUID()
      receiptRows.push({
        id: receiptId,
        paymentId: payment.id,
        receiptNo,
        fiscalYear,
        seq,
        amountPaisa: amount,
        duesBeforePaisa: duesBefore,
        discountPaisa: 0n,
        balanceAfterPaisa: duesBefore - amount,
        snapshot: buildReceiptSnapshot({
          school: SCHOOL_PROFILE,
          receiptNo,
          sessionName: String(SESSION),
          issuedAt: payment.at,
          paidDate: payment.paidDate,
          student,
          lines: receiptLines(payment),
          duesBefore: toPaisaNumber(duesBefore),
          discount: 0,
          method: payment.method,
          reference: payment.reference,
          receivedBy: users[payment.takenBy].fullName,
        }),
        createdAt: payment.at,
      })
      printRows.push({ id: randomUUID(), receiptId, printNo: 1, computer: users[payment.takenBy].computer, printedById: users[payment.takenBy].id, printedAt: payment.at })
    }

    const categoryIds = new Map<string, string>()
    for (const expense of EXPENSES) {
      if (!categoryIds.has(expense.category)) categoryIds.set(expense.category, randomUUID())
    }
    const expenseRows: Prisma.ExpenseCreateManyInput[] = EXPENSES.map((expense) => {
      const day = expense.day === 'today' ? today : bs(7, expense.day)
      return {
        id: randomUUID(),
        idempotencyKey: randomUUID(),
        categoryId: categoryIds.get(expense.category) ?? '',
        accountId: expense.account === 'cash' ? id.cash : id.bank,
        expenseDate: asDate(day),
        amountPaisa: rupees(expense.amount),
        description: expense.description,
        voucherNo: expense.voucher,
        enteredById: id.bikash,
        createdAt: at(day, expense.time),
      }
    })
    const interestCategory = randomUUID()
    const interestDay = bs(6, 30)
    const incomeRows: Prisma.IncomeCreateManyInput[] = [
      {
        id: randomUUID(),
        idempotencyKey: randomUUID(),
        categoryId: interestCategory,
        accountId: id.bank,
        incomeDate: asDate(interestDay),
        amountPaisa: rupees(1240),
        description: 'Interest for Ashwin',
        enteredById: id.sarita,
        createdAt: at(interestDay, '15:00'),
      },
    ]

    const entries: Prisma.AccountEntryCreateManyInput[] = []
    const accountOf = (method: PaymentMethod) => (method === 'cash' ? id.cash : id.bank)
    for (const payment of payments) {
      const amount = payment.allocations.reduce((sum, item) => sum + item.amount, 0n)
      entries.push({ id: randomUUID(), accountId: accountOf(payment.method), entryDate: asDate(payment.paidDate), direction: 'in', amountPaisa: amount, paymentId: payment.id, createdAt: payment.at })
    }
    for (const voidRow of voids) {
      const payment = payments.find((item) => item.id === voidRow.paymentId)
      if (payment === undefined) throw new Error('A void points at no payment.')
      const amount = payment.allocations.reduce((sum, item) => sum + item.amount, 0n)
      entries.push({ id: randomUUID(), accountId: accountOf(payment.method), entryDate: asDate(today), direction: 'out', amountPaisa: amount, voidId: voidRow.id, createdAt: voidRow.voidedAt })
    }
    for (const expense of expenseRows) {
      entries.push({ id: randomUUID(), accountId: expense.accountId, entryDate: expense.expenseDate, direction: 'out', amountPaisa: expense.amountPaisa, expenseId: expense.id, createdAt: expense.createdAt })
    }
    for (const income of incomeRows) {
      entries.push({ id: randomUUID(), accountId: income.accountId, entryDate: income.incomeDate, direction: 'in', amountPaisa: income.amountPaisa, incomeId: income.id, createdAt: income.createdAt })
    }

    function cashBefore(moment: Date): bigint {
      return entries
        .filter((entry) => entry.accountId === id.cash && entry.createdAt instanceof Date && entry.createdAt < moment)
        .reduce((sum, entry) => sum + (entry.direction === 'in' ? BigInt(entry.amountPaisa) : -BigInt(entry.amountPaisa)), 0n)
    }
    const transferRows: Prisma.TransferCreateManyInput[] = []
    for (let month = 1; month < Math.min(billedThrough, 7); month += 1) {
      const day = bs(month, daysInBsMonth(SESSION, month))
      const moment = at(day, '15:30')
      const amount = cashBefore(moment) - rupees(CASH_FLOAT_RUPEES)
      if (amount <= 0n) continue
      const transfer = { id: randomUUID(), idempotencyKey: randomUUID(), fromAccountId: id.cash, toAccountId: id.bank, transferDate: asDate(day), amountPaisa: amount, note: 'Month-end deposit', enteredById: id.sarita, createdAt: moment }
      transferRows.push(transfer)
      entries.push({ id: randomUUID(), accountId: id.cash, entryDate: transfer.transferDate, direction: 'out', amountPaisa: amount, transferId: transfer.id, createdAt: moment })
      entries.push({ id: randomUUID(), accountId: id.bank, entryDate: transfer.transferDate, direction: 'in', amountPaisa: amount, transferId: transfer.id, createdAt: moment })
    }

    const dueRows: Prisma.FeeDueCreateManyInput[] = dues.map((due) => ({
      id: due.id,
      studentId: due.studentId,
      sessionId: id.session,
      feeHeadId: due.headId,
      periodLabel: due.periodLabel,
      billDate: asDate(due.billDate),
      dueDate: asDate(due.dueDate),
      amountPaisa: due.amount,
      status: due.paid === 0n ? 'unpaid' : due.paid === due.amount ? 'paid' : 'part_paid',
    }))

    const attendanceRows: Prisma.AttendanceDayCreateManyInput[] = []
    const yesterday = previousSchoolDay(today)
    studentRows.forEach((student, index) => {
      if (index % 9 !== 5) {
        const late = index % 8 === 3
        attendanceRows.push({ personType: 'student', personId: student.id ?? '', dayDate: asDate(today), computedStatus: late ? 'L' : 'P', firstInAt: at(today, minute(late ? 10 * 60 : 9 * 60 + 15, index)) })
      }
      const absent = index % 11 === 4
      attendanceRows.push({
        personType: 'student',
        personId: student.id ?? '',
        dayDate: asDate(yesterday),
        computedStatus: absent ? 'A' : index % 7 === 2 ? 'L' : 'P',
        firstInAt: absent ? null : at(yesterday, minute(9 * 60 + 20, index)),
        isFinal: true,
      })
    })

    const virtualAdapter = /^(docker|br-|veth|virbr|podman|vboxnet|vmnet)/
    const lanAddresses = [
      ...new Set(
        Object.entries(networkInterfaces())
          .filter(([name]) => !virtualAdapter.test(name))
          .flatMap(([, list]) => list ?? [])
          .filter((item) => item.family === 'IPv4' && !item.internal)
          .map((item) => item.address),
      ),
    ]

    await db.$transaction(
      async (tx) => {
        await tx.role.createMany({ data: [{ id: id.superAdminRole, name: 'super_admin' }, { id: id.accountantRole, name: 'accountant' }] })
        await tx.rolePermission.createMany({
          data: [
            ...PERMISSION_KEYS.map((permissionKey) => ({ roleId: id.superAdminRole, permissionKey })),
            ...ACCOUNTANT_DEFAULT_PERMISSIONS.map((permissionKey) => ({ roleId: id.accountantRole, permissionKey })),
          ],
        })
        await tx.user.createMany({
          data: [
            { id: id.sarita, username: 'sarita.admin', passwordHash, fullName: users.sarita.fullName, roleId: id.superAdminRole },
            { id: id.bikash, username: 'bikash.acc', passwordHash, fullName: users.bikash.fullName, roleId: id.accountantRole },
            { id: id.puja, username: 'puja.acc', passwordHash, fullName: 'Puja Khadka', roleId: id.accountantRole, status: 'inactive' },
          ],
        })
        await tx.setting.create({ data: { key: 'school.profile', value: SCHOOL_PROFILE } })
        await tx.academicSession.create({ data: { id: id.session, name: String(SESSION), startDate: asDate(sessionStart), isCurrent: true } })
        await tx.schoolClass.createMany({ data: CLASSES.map(([name], index) => ({ id: classIds.get(name) ?? '', name, sortOrder: index + 1 })) })
        await tx.section.createMany({
          data: CLASSES.flatMap(([name]) =>
            ['A', 'B'].map((section, index) => ({ id: sectionIds.get(`${name} ${section}`) ?? '', classId: classIds.get(name) ?? '', name: section, sortOrder: index + 1 })),
          ),
        })
        await tx.student.createMany({ data: studentRows })
        await tx.studentEnrollment.createMany({ data: enrollmentRows })
        await tx.guardian.createMany({ data: guardianRows })
        await tx.feeHead.createMany({ data: [...feeHeads] })
        await tx.feeStructure.createMany({
          data: CLASSES.flatMap(([name, tuition]) => {
            const classId = classIds.get(name) ?? ''
            return [
              { sessionId: id.session, classId, feeHeadId: id.admission, amountPaisa: rupees(tuition) },
              { sessionId: id.session, classId, feeHeadId: id.tuition, amountPaisa: rupees(tuition) },
              { sessionId: id.session, classId, feeHeadId: id.annual, amountPaisa: rupees(tuition * 2) },
              { sessionId: id.session, classId, feeHeadId: id.exam, amountPaisa: rupees(tuition / 2) },
            ]
          }),
        })
        await tx.feeDue.createMany({ data: dueRows })
        await tx.fine.createMany({ data: fines.map((fine) => ({ id: fine.id, feeDueId: fine.dueId, amountPaisa: fine.amount, reason: FINE_REASON, createdAt: fine.createdAt })) })
        await tx.account.createMany({
          data: [
            { id: id.cash, name: 'Cash in hand', kind: 'cash' },
            { id: id.bank, name: 'Current account', kind: 'bank' },
          ],
        })
        await tx.payment.createMany({
          data: payments.map((payment) => ({
            id: payment.id,
            studentId: payment.studentId,
            idempotencyKey: randomUUID(),
            paidDate: asDate(payment.paidDate),
            method: payment.method,
            reference: payment.reference,
            amountPaisa: payment.allocations.reduce((sum, item) => sum + item.amount, 0n),
            accountId: accountOf(payment.method),
            takenById: users[payment.takenBy].id,
            computer: users[payment.takenBy].computer,
            createdAt: payment.at,
          })),
        })
        await tx.paymentAllocation.createMany({
          data: payments.flatMap((payment) =>
            payment.allocations.map((item) => ({ paymentId: payment.id, feeDueId: item.dueId ?? null, fineId: item.fineId ?? null, amountPaisa: item.amount, createdAt: payment.at })),
          ),
        })
        await tx.receipt.createMany({ data: receiptRows })
        await tx.receiptPrint.createMany({ data: printRows })
        await tx.receiptCounter.createMany({ data: [...counters].map(([fiscalYear, lastSeq]) => ({ fiscalYear, lastSeq })) })
        await tx.incomeCategory.create({ data: { id: interestCategory, name: 'Bank interest' } })
        await tx.income.createMany({ data: incomeRows })
        await tx.expenseCategory.createMany({ data: [...categoryIds].map(([name, categoryId]) => ({ id: categoryId, name })) })
        await tx.expense.createMany({ data: expenseRows })
        await tx.voidRequest.createMany({ data: voidRequests })
        await tx.voidRecord.createMany({ data: voids })
        await tx.transfer.createMany({ data: transferRows })
        await tx.accountEntry.createMany({ data: entries })
        await tx.attendanceRule.createMany({
          data: (['student', 'staff'] as const).map((appliesTo) => ({
            appliesTo,
            startTime: '09:45',
            graceMinutes: 10,
            lastCheckinTime: '11:00',
            earlyLeaveBefore: '15:30',
            dayCloseTime: '16:00',
            requireCheckout: false,
            duplicateWindowMinutes: 2,
          })),
        })
        await tx.device.create({
          data: { id: id.device, name: 'Main gate device', connection: 'lan', host: '192.168.1.201', port: 4370, lastSyncAt: at(today, '10:40'), lastSuccessAt: at(today, '10:40') },
        })
        await tx.deviceSyncRun.create({
          data: { deviceId: id.device, startedAt: at(today, '10:40'), finishedAt: at(today, '10:40'), readCount: 112, newCount: 109, duplicateCount: 3 },
        })
        await tx.attendanceDay.createMany({ data: attendanceRows })
        if (lanAddresses.length > 0) {
          await tx.allowedComputer.createMany({ data: lanAddresses.map((ip) => ({ ip, computerName: hostname(), allowedById: id.sarita })) })
        }
        await tx.auditLog.create({ data: { computer: 1, action: 'dev.seed', area: 'System', summary: 'Development sample school loaded.' } })
      },
      { timeout: 120_000 },
    )

    process.stdout.write(
      `Sample school loaded: ${STUDENTS.length} students, ${payments.length} receipts, ${expenseRows.length} expenses, ${transferRows.length} transfers.\n` +
        `Sign in as sarita.admin or bikash.acc with the password ${DEV_PASSWORD}.\n`,
    )
  } finally {
    await db.$disconnect()
  }
}

await main(databaseUrl)
