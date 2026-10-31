import { Prisma } from '@mikey/db'

import type { Db } from '../deps.ts'

interface OutstandingRow {
  student_id: string
  outstanding: bigint
  overpaid: boolean
}

// What each student owes, for many students in one query, worked out as readLedger does it:
// every due not cancelled and every fine not waived, less the money taken against it by payments
// not voided. Students who owe nothing are left out. A test checks it agrees with readLedger.
export async function outstandingByStudent(db: Db, studentIds?: readonly string[]): Promise<Map<string, bigint>> {
  const only = studentIds === undefined ? Prisma.empty : Prisma.sql`WHERE student_id = ANY(${[...studentIds]}::uuid[])`
  const rows = await db.$queryRaw<OutstandingRow[]>`
    WITH dues AS (
      SELECT id, student_id, amount_paisa - discount_paisa AS amount, status FROM fee_dues ${only}
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
    remaining AS (
      SELECT d.student_id, d.amount - COALESCE(t.amount, 0) AS amount
      FROM dues d LEFT JOIN taken t ON t.fee_due_id = d.id
      WHERE d.status <> 'cancelled'
      UNION ALL
      SELECT f.student_id, f.amount - COALESCE(t.amount, 0) AS amount
      FROM due_fines f LEFT JOIN taken t ON t.fine_id = f.id
      WHERE f.waived_at IS NULL
    )
    SELECT student_id, SUM(amount)::bigint AS outstanding, bool_or(amount < 0) AS overpaid
    FROM remaining
    GROUP BY student_id`
  const owed = new Map<string, bigint>()
  for (const row of rows) {
    // Overpayment is never taken, so it means the records are wrong; say so rather than hide it.
    if (row.overpaid) {
      throw new Error(`Student ${row.student_id} has a due or fine paid more than it owes.`)
    }
    if (row.outstanding > 0n) {
      owed.set(row.student_id, row.outstanding)
    }
  }
  return owed
}
