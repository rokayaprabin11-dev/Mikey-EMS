import type { Prisma } from '@mikey/db'
import { type PaymentListItem, type PaymentsListQuery, type PaymentsListResponse, receiptSnapshotSchema } from '@mikey/shared'

import type { SessionContext } from '../auth/sessions.ts'
import { toDbDate } from '../dates.ts'
import type { Db } from '../deps.ts'
import { statusOf } from './receipts.ts'

// Status is never stored: voided if a void points at the payment, void requested if a pending
// request does, otherwise posted.
function statusFilter(status: PaymentListItem['status']): Prisma.PaymentWhereInput {
  if (status === 'voided') {
    return { voidRecord: { isNot: null } }
  }
  const pending = { status: 'pending' } as const
  return status === 'void_requested'
    ? { voidRecord: { is: null }, voidRequests: { some: pending } }
    : { voidRecord: { is: null }, voidRequests: { none: pending } }
}

function searchFilter(search: string): Prisma.PaymentWhereInput {
  return {
    OR: [
      { receipt: { receiptNo: { contains: search } } },
      { student: { fullName: { contains: search, mode: 'insensitive' } } },
      { student: { studentCode: { contains: search, mode: 'insensitive' } } },
    ],
  }
}

// One day's receipts, newest first, shown as they were printed (from each receipt's snapshot).
export async function listPayments(db: Db, query: PaymentsListQuery, session: SessionContext): Promise<PaymentsListResponse> {
  const search = query.search ?? ''
  const rows = await db.payment.findMany({
    where: {
      paidDate: toDbDate(query.date),
      ...(query.takenBy === 'me' ? { takenById: session.user.id } : {}),
      ...(query.method === undefined ? {} : { method: query.method }),
      ...(query.status === undefined ? {} : statusFilter(query.status)),
      ...(search === '' ? {} : searchFilter(search)),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      studentId: true,
      createdAt: true,
      receipt: { select: { snapshot: true } },
      voidRecord: { select: { id: true } },
      voidRequests: { where: { status: 'pending' }, select: { id: true } },
    },
  })
  const payments = rows.map((row): PaymentListItem => {
    if (row.receipt === null) {
      throw new Error(`Payment ${row.id} has no receipt.`)
    }
    const snapshot = receiptSnapshotSchema.parse(row.receipt.snapshot)
    return {
      paymentId: row.id,
      receiptNo: snapshot.receiptNo,
      takenAt: row.createdAt.toISOString(),
      takenBy: snapshot.receivedBy,
      student: {
        id: row.studentId,
        fullName: snapshot.student.fullName,
        className: snapshot.student.className,
        sectionName: snapshot.student.sectionName,
      },
      method: snapshot.method,
      status: statusOf(row),
      amount: snapshot.totals.amountPaid,
    }
  })
  const total = payments.filter((payment) => payment.status !== 'voided').reduce((sum, payment) => sum + payment.amount, 0)
  return { payments, total }
}
