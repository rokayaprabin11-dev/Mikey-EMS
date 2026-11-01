import { Prisma } from '@mikey/db'
import {
  receiptSnapshotSchema,
  type StudentFees,
  type StudentRef,
  type StudentSearchQuery,
  type StudentSearchResponse,
  type StudentSummary,
  toPaisaNumber,
} from '@mikey/shared'

import { fromDbDate } from '../dates.ts'
import type { Db } from '../deps.ts'
import { fail } from '../errors.ts'
import { owedItems, readLedger } from '../fees/ledger.ts'
import { outstandingByStudent } from '../fees/outstanding.ts'
import { recordStatus } from '../record-status.ts'

const MAX_RESULTS = 20
// Roll numbers are at most three digits. A phone number is searched from four digits on, by its
// first digits or its last ones.
const ROLL_DIGITS = 3
const PHONE_DIGITS_AT_LEAST = 4

// These match the indexes in the student_search migration exactly, so the planner can use them.
const NAME_AND_ID_WORDS = Prisma.sql`to_tsvector('simple'::regconfig, regexp_replace("full_name" || ' ' || "student_code", '[^[:alnum:]]+', ' ', 'g'))`
const PHONE_DIGITS = Prisma.sql`to_tsvector('simple'::regconfig,
  regexp_replace("phone", '[^0-9]', '', 'g') || ' ' || regexp_replace(coalesce("alt_phone", ''), '[^0-9]', '', 'g')
  || ' r' || reverse(regexp_replace("phone", '[^0-9]', '', 'g'))
  || ' r' || reverse(regexp_replace(coalesce("alt_phone", ''), '[^0-9]', '', 'g')))`

// Each student's latest enrollment (by the session's start date), as fee collection uses it.
export const LATEST_ENROLLMENTS = Prisma.sql`
  SELECT DISTINCT ON (e.student_id) e.student_id, e.section_id, e.roll_no
  FROM student_enrollments e
  JOIN academic_sessions a ON a.id = e.session_id
  ORDER BY e.student_id, a.start_date DESC`

interface FoundRow {
  id: string
  code: string
  full_name: string
  status: 'active' | 'inactive'
  roll_no: number
  class_name: string
  section_name: string
}

// The students the typed text matches: the start of any word of the name or student ID, the first
// or the last digits of a guardian's phone number typed with or without spaces, or a roll number.
// Null when nothing was typed.
function matching(text: string): Prisma.Sql | null {
  const words = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== '')
  if (words.length === 0) {
    return null
  }
  const tests = [
    Prisma.sql`SELECT id AS student_id FROM students WHERE ${NAME_AND_ID_WORDS} @@ to_tsquery('simple', ${words.map((word) => `${word}:*`).join(' & ')})`,
  ]
  const digits = /^[\d\s()+-]+$/.test(text) ? text.replace(/\D/g, '') : ''
  if (digits.length >= PHONE_DIGITS_AT_LEAST) {
    // The last digits are the start of the reversed number, which the index keeps after an "r".
    const lastDigits = `r${[...digits].reverse().join('')}`
    tests.push(
      Prisma.sql`SELECT student_id FROM guardians WHERE ${PHONE_DIGITS} @@ to_tsquery('simple', ${`${digits}:* | ${lastDigits}:*`})`,
    )
  }
  if (digits !== '' && digits.length <= ROLL_DIGITS) {
    tests.push(Prisma.sql`SELECT student_id FROM latest WHERE roll_no = ${Number(digits)}`)
  }
  return Prisma.join(tests, ' UNION ')
}

// Students in the class of their latest enrollment, as fee collection finds it, sorted by name.
// The matches are worked out first (MATERIALIZED), so the planner looks them up in the indexes
// instead of testing every student.
function findStudents(db: Db, matched: Prisma.Sql | null, conditions: Prisma.Sql, limit: number | null): Promise<FoundRow[]> {
  return db.$queryRaw<FoundRow[]>`
    WITH latest AS (${LATEST_ENROLLMENTS})${matched === null ? Prisma.empty : Prisma.sql`, matched AS MATERIALIZED (${matched})`}
    SELECT s.id, s.student_code AS code, s.full_name, s.status::text AS status, l.roll_no,
      c.name AS class_name, sec.name AS section_name
    FROM students s
    ${matched === null ? Prisma.empty : Prisma.sql`JOIN matched m ON m.student_id = s.id`}
    JOIN latest l ON l.student_id = s.id
    JOIN sections sec ON sec.id = l.section_id
    JOIN classes c ON c.id = sec.class_id
    WHERE TRUE ${conditions}
    ORDER BY s.full_name, s.student_code, s.id
    ${limit === null ? Prisma.empty : Prisma.sql`LIMIT ${limit}`}`
}

async function firstGuardians(db: Db, studentIds: string[]) {
  const guardians = await db.guardian.findMany({
    where: { studentId: { in: studentIds } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { studentId: true, fullName: true, relationship: true, phone: true },
  })
  const first = new Map<string, (typeof guardians)[number]>()
  for (const guardian of guardians) {
    if (!first.has(guardian.studentId)) {
      first.set(guardian.studentId, guardian)
    }
  }
  return first
}

function summaryOf(row: FoundRow, guardian: { fullName: string; phone: string } | undefined, outstanding: bigint): StudentSummary {
  return {
    id: row.id,
    fullName: row.full_name,
    className: row.class_name,
    sectionName: row.section_name,
    code: row.code,
    rollNo: row.roll_no,
    status: row.status,
    guardianName: guardian?.fullName ?? null,
    guardianPhone: guardian?.phone ?? null,
    outstanding: toPaisaNumber(outstanding),
  }
}

export async function searchStudents(db: Db, query: StudentSearchQuery): Promise<StudentSearchResponse> {
  const inClass = query.classId === undefined ? Prisma.empty : Prisma.sql`AND sec.class_id = ${query.classId}::uuid`
  const withDues = query.withDues === true
  // With "only with dues", what is owed decides which students are listed, so every match counts.
  const rows = await findStudents(db, matching(query.q ?? ''), inClass, withDues ? null : MAX_RESULTS)
  const owed = await outstandingByStudent(
    db,
    rows.map((row) => row.id),
  )
  const shown = (withDues ? rows.filter((row) => owed.has(row.id)) : rows).slice(0, MAX_RESULTS)
  const guardians = await firstGuardians(
    db,
    shown.map((row) => row.id),
  )
  return { students: shown.map((row) => summaryOf(row, guardians.get(row.id), owed.get(row.id) ?? 0n)) }
}

// The names and classes of several students, for lists that point at them.
export async function studentRefs(db: Db, studentIds: readonly string[]): Promise<Map<string, StudentRef>> {
  const rows = await findStudents(db, null, Prisma.sql`AND s.id = ANY(${[...studentIds]}::uuid[])`, null)
  return new Map(
    rows.map((row) => [row.id, { id: row.id, fullName: row.full_name, className: row.class_name, sectionName: row.section_name }]),
  )
}

// One student as the lookup screen shows them: contacts, what they owe, and every receipt.
export async function studentFees(db: Db, studentId: string): Promise<StudentFees> {
  const [row] = await findStudents(db, null, Prisma.sql`AND s.id = ${studentId}::uuid`, 1)
  if (row === undefined) {
    throw fail('NOT_FOUND', { what: 'student' })
  }
  const guardian = (await firstGuardians(db, [studentId])).get(studentId)
  const ledger = await readLedger(db, studentId)
  const { session } = await db.studentEnrollment.findFirstOrThrow({
    where: { studentId },
    orderBy: { session: { startDate: 'desc' } },
    select: { session: { select: { name: true, startDate: true, endDate: true } } },
  })
  const payments = await db.payment.findMany({
    where: { studentId },
    orderBy: [{ paidDate: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      paidDate: true,
      receipt: { select: { snapshot: true } },
      voidRecord: { select: { id: true } },
      voidRequests: { where: { status: 'pending' }, select: { id: true } },
    },
  })

  const paidThisSession = { sessionName: session.name, amount: 0, receiptCount: 0 }
  const history = payments.map((payment) => {
    if (payment.receipt === null) {
      throw new Error(`Payment ${payment.id} has no receipt.`)
    }
    const snapshot = receiptSnapshotSchema.parse(payment.receipt.snapshot)
    const status = recordStatus(payment)
    const inSession = payment.paidDate >= session.startDate && (session.endDate === null || payment.paidDate <= session.endDate)
    if (status !== 'voided' && inSession) {
      paidThisSession.amount += snapshot.totals.amountPaid
      paidThisSession.receiptCount += 1
    }
    return {
      paymentId: payment.id,
      paidDate: fromDbDate(payment.paidDate),
      receiptNo: snapshot.receiptNo,
      method: snapshot.method,
      status,
      amount: snapshot.totals.amountPaid,
      lines: snapshot.lines,
    }
  })
  return {
    student: { ...summaryOf(row, guardian, ledger.outstanding), guardianRelationship: guardian?.relationship ?? null },
    dues: owedItems(ledger),
    paidThisSession,
    payments: history,
  }
}
