import type { Prisma } from '@mikey/db'
import {
  formatRupees,
  kathmanduDate,
  receiptSnapshotSchema,
  toPaisaNumber,
  type VoidApproval,
  type VoidDecline,
  type VoidRequest,
  type VoidRequestCreate,
} from '@mikey/shared'

import { writeAudit } from '../audit.ts'
import type { RequestContext, SessionContext } from '../auth/sessions.ts'
import { toDbDate } from '../dates.ts'
import type { AppDeps, Db } from '../deps.ts'
import { fail } from '../errors.ts'
import { type FeeDueBalance, readLedger } from './ledger.ts'

const requestDetails = {
  requestedBy: { select: { fullName: true } },
  decidedBy: { select: { fullName: true } },
  payment: { select: { id: true, createdAt: true, receipt: { select: { snapshot: true } } } },
} satisfies Prisma.VoidRequestInclude

type RequestRow = Prisma.VoidRequestGetPayload<{ include: typeof requestDetails }>

// A request shows the receipt as it was printed.
function toVoidRequest(row: RequestRow): VoidRequest {
  const receipt = row.payment?.receipt ?? null
  if (row.payment === null || receipt === null) {
    throw new Error(`Void request ${row.id} is not about a receipt.`)
  }
  const snapshot = receiptSnapshotSchema.parse(receipt.snapshot)
  return {
    id: row.id,
    target: {
      type: 'payment',
      id: row.payment.id,
      receiptNo: snapshot.receiptNo,
      studentName: snapshot.student.fullName,
      className: snapshot.student.className,
      sectionName: snapshot.student.sectionName,
      method: snapshot.method,
      takenAt: row.payment.createdAt.toISOString(),
      amount: snapshot.totals.amountPaid,
    },
    reason: row.reason,
    details: row.details,
    status: row.status,
    requestedAt: row.requestedAt.toISOString(),
    requestedBy: row.requestedBy.fullName,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    decidedBy: row.decidedBy?.fullName ?? null,
    decisionNote: row.decisionNote,
  }
}

async function readVoidRequest(db: Db, id: string): Promise<VoidRequest> {
  return toVoidRequest(await db.voidRequest.findUniqueOrThrow({ where: { id }, include: requestDetails }))
}

export async function listVoidRequests(
  db: Db,
  where: Prisma.VoidRequestWhereInput,
  order: 'asc' | 'desc',
): Promise<VoidRequest[]> {
  const rows = await db.voidRequest.findMany({
    where: { ...where, paymentId: { not: null } },
    include: requestDetails,
    orderBy: [{ requestedAt: order }, { id: order }],
  })
  return rows.map(toVoidRequest)
}

interface RequestVoidInput extends RequestContext {
  session: SessionContext
  body: VoidRequestCreate
}

// The Accountant asks; nothing about the money changes until the Super Admin approves.
export async function requestVoid(deps: AppDeps, input: RequestVoidInput): Promise<VoidRequest> {
  const { body, session, now, computer } = input
  const requestId = await deps.db.$transaction(async (tx) => {
    // Requests for one receipt happen one at a time.
    await tx.$executeRaw`SELECT id FROM payments WHERE id = ${body.target.id}::uuid FOR UPDATE`
    const receipt = await tx.receipt.findUnique({ where: { paymentId: body.target.id }, select: { receiptNo: true } })
    if (receipt === null) {
      throw fail('NOT_FOUND', { what: 'receipt' })
    }
    if ((await tx.voidRecord.count({ where: { paymentId: body.target.id } })) > 0) {
      throw fail('RECEIPT_ALREADY_VOIDED')
    }
    if ((await tx.voidRequest.count({ where: { paymentId: body.target.id, status: 'pending' } })) > 0) {
      throw fail('VOID_ALREADY_REQUESTED')
    }
    const request = await tx.voidRequest.create({
      data: {
        paymentId: body.target.id,
        reason: body.reason,
        details: body.details,
        requestedById: session.user.id,
        requestedAt: now,
      },
    })
    await writeAudit(tx, {
      at: now,
      userId: session.user.id,
      computer,
      action: 'payments.void_requested',
      area: 'Payments',
      recordType: 'payment',
      recordId: body.target.id,
      summary: `${session.user.fullName} asked for receipt ${receipt.receiptNo} to be voided`,
      after: { voidRequestId: request.id, reason: body.reason, details: body.details },
    })
    return request.id
  })
  return readVoidRequest(deps.db, requestId)
}

interface DecisionInput<B> extends RequestContext {
  session: SessionContext
  params: { requestId: string }
  body: B
}

// Locking the request makes a second decision wait, then find it already answered.
async function lockPendingRequest(tx: Db, requestId: string) {
  await tx.$executeRaw`SELECT id FROM void_requests WHERE id = ${requestId}::uuid FOR UPDATE`
  const request = await tx.voidRequest.findUnique({ where: { id: requestId } })
  if (request === null) {
    throw fail('NOT_FOUND', { what: 'request' })
  }
  if (request.status !== 'pending') {
    throw fail('REQUEST_NOT_PENDING')
  }
  if (request.paymentId === null) {
    throw new Error(`Void request ${request.id} is not about a receipt.`)
  }
  return { ...request, paymentId: request.paymentId }
}

function dueStatus(due: FeeDueBalance): 'paid' | 'part_paid' | 'unpaid' {
  if (due.remaining === 0n) {
    return 'paid'
  }
  return due.paid === 0n ? 'unpaid' : 'part_paid'
}

// After the void is saved the payment's money no longer counts, so the dues it paid are owed
// again. Fines have no stored status and reopen by themselves; cancelled dues stay cancelled.
async function reopenDues(tx: Db, payment: { id: string; studentId: string }): Promise<void> {
  const allocations = await tx.paymentAllocation.findMany({
    where: { paymentId: payment.id, feeDueId: { not: null } },
    select: { feeDueId: true },
  })
  const ledger = await readLedger(tx, payment.studentId)
  for (const allocation of allocations) {
    const due = ledger.feeDues.find((row) => row.id === allocation.feeDueId)
    if (due !== undefined && due.owed) {
      await tx.feeDue.update({ where: { id: due.id }, data: { status: dueStatus(due), version: { increment: 1 } } })
    }
  }
}

// Only the Super Admin approves, and never a request they made themselves. The receipt keeps its
// number; the money goes back out of the account it came into, dated today.
export async function approveVoid(deps: AppDeps, input: DecisionInput<VoidApproval>): Promise<VoidRequest> {
  const { params, body, session, now, computer } = input
  const note = body.note === undefined || body.note === '' ? null : body.note
  await deps.db.$transaction(async (tx) => {
    const request = await lockPendingRequest(tx, params.requestId)
    if (request.requestedById === session.user.id) {
      throw fail('OWN_VOID_REQUEST')
    }
    const payment = await tx.payment.findUniqueOrThrow({ where: { id: request.paymentId } })
    // Anything that changes what a student owes locks the student row first.
    await tx.$executeRaw`SELECT id FROM students WHERE id = ${payment.studentId}::uuid FOR UPDATE`
    if ((await tx.voidRecord.count({ where: { paymentId: payment.id } })) > 0) {
      throw fail('RECEIPT_ALREADY_VOIDED')
    }
    const voided = await tx.voidRecord.create({
      data: {
        paymentId: payment.id,
        reason: request.reason,
        note,
        voidRequestId: request.id,
        voidedById: session.user.id,
        voidedAt: now,
      },
    })
    await tx.accountEntry.create({
      data: {
        accountId: payment.accountId,
        entryDate: toDbDate(kathmanduDate(now)),
        direction: 'out',
        amountPaisa: payment.amountPaisa,
        voidId: voided.id,
        createdAt: now,
      },
    })
    await tx.voidRequest.update({
      where: { id: request.id },
      data: { status: 'approved', decidedById: session.user.id, decidedAt: now, decisionNote: note },
    })
    await reopenDues(tx, payment)
    const receipt = await tx.receipt.findUniqueOrThrow({ where: { paymentId: payment.id }, select: { receiptNo: true } })
    const requester = await tx.user.findUniqueOrThrow({ where: { id: request.requestedById }, select: { fullName: true } })
    await writeAudit(tx, {
      at: now,
      userId: session.user.id,
      computer,
      action: 'payments.voided',
      area: 'Payments',
      recordType: 'payment',
      recordId: payment.id,
      summary: `${session.user.fullName} voided receipt ${receipt.receiptNo} (${formatRupees(toPaisaNumber(payment.amountPaisa))}) at the request of ${requester.fullName}`,
      after: { voidId: voided.id, voidRequestId: request.id, note },
    })
  })
  return readVoidRequest(deps.db, params.requestId)
}

export async function declineVoid(deps: AppDeps, input: DecisionInput<VoidDecline>): Promise<VoidRequest> {
  const { params, body, session, now, computer } = input
  await deps.db.$transaction(async (tx) => {
    const request = await lockPendingRequest(tx, params.requestId)
    await tx.voidRequest.update({
      where: { id: request.id },
      data: { status: 'declined', decidedById: session.user.id, decidedAt: now, decisionNote: body.note },
    })
    const receipt = await tx.receipt.findUniqueOrThrow({ where: { paymentId: request.paymentId }, select: { receiptNo: true } })
    await writeAudit(tx, {
      at: now,
      userId: session.user.id,
      computer,
      action: 'payments.void_declined',
      area: 'Payments',
      recordType: 'payment',
      recordId: request.paymentId,
      summary: `${session.user.fullName} declined the request to void receipt ${receipt.receiptNo}`,
      after: { voidRequestId: request.id, note: body.note },
    })
  })
  return readVoidRequest(deps.db, params.requestId)
}
