import type { Prisma } from '@mikey/db'
import {
  PAYMENT_METHODS,
  type PaymentListItem,
  type PaymentsListQuery,
  type PaymentsListResponse,
  receiptSnapshotSchema,
} from '@mikey/shared'

import type { SessionContext } from '../auth/sessions.ts'
import { toDbDate } from '../dates.ts'
import type { Db } from '../deps.ts'
import { recordStatus } from '../record-status.ts'

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

export const listedPayment = {
  id: true,
  studentId: true,
  createdAt: true,
  receipt: { select: { snapshot: true, _count: { select: { allowances: true } } } },
  voidRecord: { select: { id: true } },
  voidRequests: { where: { status: 'pending' }, select: { id: true } },
} satisfies Prisma.PaymentSelect

// A receipt as lists show it: as it was printed (from its snapshot), with its status worked out.
export function toPaymentListItem(row: Prisma.PaymentGetPayload<{ select: typeof listedPayment }>): PaymentListItem {
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
    status: recordStatus(row),
    amount: snapshot.totals.amountPaid,
    lines: snapshot.lines,
    extraOriginalsAllowed: row.receipt._count.allowances,
  }
}

// A day's receipts (or several days'), newest first, shown as they were printed (from each
// receipt's snapshot).
export async function listPayments(db: Db, query: PaymentsListQuery, session: SessionContext): Promise<PaymentsListResponse> {
  const search = query.search ?? ''
  const rows = await db.payment.findMany({
    where: {
      paidDate: { gte: toDbDate(query.from), lte: toDbDate(query.to ?? query.from) },
      ...(query.takenBy === 'me' ? { takenById: session.user.id } : {}),
      ...(query.method === undefined ? {} : { method: query.method }),
      ...(query.status === undefined ? {} : statusFilter(query.status)),
      ...(search === '' ? {} : searchFilter(search)),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: listedPayment,
  })
  const payments = rows.map(toPaymentListItem)
  const standing = payments.filter((payment) => payment.status !== 'voided')
  const byMethod = PAYMENT_METHODS.flatMap((method) => {
    const paid = standing.filter((payment) => payment.method === method)
    return paid.length === 0
      ? []
      : [{ method, receiptCount: paid.length, amount: paid.reduce((sum, payment) => sum + payment.amount, 0) }]
  })
  return { payments, total: standing.reduce((sum, payment) => sum + payment.amount, 0), byMethod }
}
