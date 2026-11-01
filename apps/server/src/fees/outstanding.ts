import { Prisma } from '@mikey/db'
import type { AdDate } from '@mikey/shared'

import type { Db } from '../deps.ts'

interface OwedRow {
  student_id: string
  billed: bigint
  outstanding: bigint
  overpaid: boolean
}

export interface Owed {
  billed: bigint
  outstanding: bigint
}

interface OwedFilter {
  studentIds?: readonly string[]
  // Only dues billed in this period, with their fines.
  billed?: { from: AdDate; to: AdDate }
}

// What each student was billed and still owes, for many students in one query, worked out as
// readLedger does it: every due not cancelled and every fine not waived, less the money taken
// against it by payments not voided. A test checks it agrees with readLedger.
export async function owedByStudent(db: Db, filter: OwedFilter = {}): Promise<Map<string, Owed>> {
  const conditions: Prisma.Sql[] = []
  if (filter.studentIds !== undefined) {
    conditions.push(Prisma.sql`student_id = ANY(${[...filter.studentIds]}::uuid[])`)
  }
  if (filter.billed !== undefined) {
    conditions.push(Prisma.sql`bill_date BETWEEN ${filter.billed.from}::date AND ${filter.billed.to}::date`)
  }
  const where = conditions.length === 0 ? Prisma.empty : Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
  const rows = await db.$queryRaw<OwedRow[]>`
    WITH dues AS (
      SELECT id, student_id, amount_paisa - discount_paisa AS amount, status FROM fee_dues ${where}
    ),
    due_fines AS (
      SELECT f.id, d.student_id, f.amount_paisa AS amount, f.waived_at FROM fines f JOIN dues d ON d.id = f.fee_due_id
    ),
    taken AS (
      SELECT a.fee_due_id, a.fine_id, SUM(a.amount_paisa) AS amount
      FROM payment_allocations a
      WHERE (a.fee_due_id IN (SELECT id FROM dues) OR a.fine_id IN (SELECT id FROM due_fines))
        AND NOT EXISTS (SELECT 1 FROM voids v WHERE v.payment_id = a.payment_id)
      GROUP BY a.fee_due_id, a.fine_id
    ),
    items AS (
      SELECT d.student_id, d.amount AS billed, d.amount - COALESCE(t.amount, 0) AS remaining
      FROM dues d LEFT JOIN taken t ON t.fee_due_id = d.id
      WHERE d.status <> 'cancelled'
      UNION ALL
      SELECT f.student_id, f.amount AS billed, f.amount - COALESCE(t.amount, 0) AS remaining
      FROM due_fines f LEFT JOIN taken t ON t.fine_id = f.id
      WHERE f.waived_at IS NULL
    )
    SELECT student_id, SUM(billed)::bigint AS billed, SUM(remaining)::bigint AS outstanding, bool_or(remaining < 0) AS overpaid
    FROM items
    GROUP BY student_id`
  const owed = new Map<string, Owed>()
  for (const row of rows) {
    // Overpayment is never taken, so it means the records are wrong; say so rather than hide it.
    if (row.overpaid) {
      throw new Error(`Student ${row.student_id} has a due or fine paid more than it owes.`)
    }
    owed.set(row.student_id, { billed: row.billed, outstanding: row.outstanding })
  }
  return owed
}

// What each student owes now; students who owe nothing are left out.
export async function outstandingByStudent(db: Db, studentIds?: readonly string[]): Promise<Map<string, bigint>> {
  const outstanding = new Map<string, bigint>()
  for (const [studentId, owed] of await owedByStudent(db, studentIds === undefined ? {} : { studentIds })) {
    if (owed.outstanding > 0n) {
      outstanding.set(studentId, owed.outstanding)
    }
  }
  return outstanding
}
