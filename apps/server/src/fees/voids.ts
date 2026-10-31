import type { Prisma } from '@mikey/db'
import {
  formatRupees,
  kathmanduDate,
  receiptSnapshotSchema,
  toPaisaNumber,
  type VoidApproval,
  type VoidDecline,
  type VoidRequest,
  type VoidReason,
  type VoidRequestCreate,
} from '@mikey/shared'

import { balanceOf, lockAccount } from '../accounts/accounts.ts'
import { writeAudit } from '../audit.ts'
import type { RequestContext, SessionContext } from '../auth/sessions.ts'
import { toDbDate } from '../dates.ts'
import type { AppDeps, Db } from '../deps.ts'
import { fail } from '../errors.ts'
import { type FeeDueBalance, readLedger } from './ledger.ts'

// A void is about a receipt (its payment), an income or an expense.
type Target = VoidRequestCreate['target']

const wordFor = { payment: 'receipt', income: 'income', expense: 'expense' } as const

function targetOf(row: { paymentId: string | null; incomeId: string | null; expenseId: string | null }): Target {
  if (row.paymentId !== null) {
    return { type: 'payment', id: row.paymentId }
  }
  if (row.incomeId !== null) {
    return { type: 'income', id: row.incomeId }
  }
  if (row.expenseId !== null) {
    return { type: 'expense', id: row.expenseId }
  }
  throw new Error('A void points at nothing.')
}

function targetLink(target: Target): { paymentId: string } | { incomeId: string } | { expenseId: string } {
  if (target.type === 'payment') {
    return { paymentId: target.id }
  }
  return target.type === 'income' ? { incomeId: target.id } : { expenseId: target.id }
}

const requestDetails = {
  requestedBy: { select: { fullName: true } },
  decidedBy: { select: { fullName: true } },
  payment: { select: { id: true, createdAt: true, receipt: { select: { snapshot: true } } } },
  income: { select: { id: true, description: true, amountPaisa: true } },
  expense: { select: { id: true, description: true, amountPaisa: true } },
} satisfies Prisma.VoidRequestInclude

type RequestRow = Prisma.VoidRequestGetPayload<{ include: typeof requestDetails }>

// A request about a receipt shows the receipt as it was printed.
function targetView(row: RequestRow): VoidRequest['target'] {
  if (row.payment !== null) {
    if (row.payment.receipt === null) {
      throw new Error(`Payment ${row.payment.id} has no receipt.`)
    }
    const snapshot = receiptSnapshotSchema.parse(row.payment.receipt.snapshot)
    return {
      type: 'payment',
      id: row.payment.id,
      receiptNo: snapshot.receiptNo,
      studentName: snapshot.student.fullName,
      className: snapshot.student.className,
      sectionName: snapshot.student.sectionName,
      method: snapshot.method,
      takenAt: row.payment.createdAt.toISOString(),
      amount: snapshot.totals.amountPaid,
    }
  }
  const entry = row.income ?? row.expense
  if (entry === null) {
    throw new Error(`Void request ${row.id} points at nothing.`)
  }
  return {
    type: row.income === null ? 'expense' : 'income',
    id: entry.id,
    description: entry.description,
    amount: toPaisaNumber(entry.amountPaisa),
  }
}

function toVoidRequest(row: RequestRow): VoidRequest {
  return {
    id: row.id,
    target: targetView(row),
    reason: row.reason,
    details: row.details,
    status: row.status,
    requestedAt: row.requestedAt.toISOString(),
    requestedBy: row.requestedBy.fullName,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    decidedBy: row.decidedBy?.fullName ?? null,
    decisionNote: row.decisionNote,
    direct: row.direct,
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
    where,
    include: requestDetails,
    orderBy: [{ requestedAt: order }, { id: order }],
  })
  return rows.map(toVoidRequest)
}

// Locks the receipt's payment, the income or the expense, and says how to name it.
async function lockTarget(tx: Db, target: Target): Promise<string> {
  if (target.type === 'payment') {
    await tx.$executeRaw`SELECT id FROM payments WHERE id = ${target.id}::uuid FOR UPDATE`
    const receipt = await tx.receipt.findUnique({ where: { paymentId: target.id }, select: { receiptNo: true } })
    if (receipt === null) {
      throw fail('NOT_FOUND', { what: 'receipt' })
    }
    return `receipt ${receipt.receiptNo}`
  }
  if (target.type === 'income') {
    await tx.$executeRaw`SELECT id FROM incomes WHERE id = ${target.id}::uuid FOR UPDATE`
    const income = await tx.income.findUnique({ where: { id: target.id }, select: { description: true } })
    if (income === null) {
      throw fail('NOT_FOUND', { what: 'entry' })
    }
    return `the income "${income.description}"`
  }
  await tx.$executeRaw`SELECT id FROM expenses WHERE id = ${target.id}::uuid FOR UPDATE`
  const expense = await tx.expense.findUnique({ where: { id: target.id }, select: { description: true } })
  if (expense === null) {
    throw fail('NOT_FOUND', { what: 'entry' })
  }
  return `the expense "${expense.description}"`
}

interface RequestVoidInput extends RequestContext {
  session: SessionContext
  body: VoidRequestCreate
}

// The Accountant asks; nothing about the money changes until the Super Admin approves.
export async function requestVoid(deps: AppDeps, input: RequestVoidInput): Promise<VoidRequest> {
  const { body, session, now, computer } = input
  const target = body.target
  const requestId = await deps.db.$transaction(async (tx) => {
    // Requests for one record happen one at a time.
    const label = await lockTarget(tx, target)
    if ((await tx.voidRecord.count({ where: targetLink(target) })) > 0) {
      throw fail('ALREADY_VOIDED', { what: wordFor[target.type] })
    }
    if ((await tx.voidRequest.count({ where: { ...targetLink(target), status: 'pending' } })) > 0) {
      throw fail('VOID_ALREADY_REQUESTED', { what: wordFor[target.type] })
    }
    const request = await tx.voidRequest.create({
      data: {
        ...targetLink(target),
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
      area: target.type === 'payment' ? 'Payments' : 'Accounts',
      recordType: target.type,
      recordId: target.id,
      summary: `${session.user.fullName} asked for ${label} to be voided`,
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

// Every void takes its locks in the same order: the record, its request, the student, the account.
// So two voids, or a void and a payment, can never wait on each other.
async function lockRequestAndTarget(tx: Db, requestId: string) {
  const peek = await tx.voidRequest.findUnique({ where: { id: requestId } })
  if (peek === null) {
    throw fail('NOT_FOUND', { what: 'request' })
  }
  const target = targetOf(peek)
  const label = await lockTarget(tx, target)
  // Locking the request makes a second decision wait, then find it already answered.
  await tx.$executeRaw`SELECT id FROM void_requests WHERE id = ${requestId}::uuid FOR UPDATE`
  const request = await tx.voidRequest.findUniqueOrThrow({ where: { id: requestId } })
  if (request.status !== 'pending') {
    throw fail('REQUEST_NOT_PENDING')
  }
  return { request, target, label }
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

// The money a void moves: back out of the account a receipt or an income went into, or back into
// the account an expense was paid from.
async function reversalOf(tx: Db, target: Target) {
  if (target.type === 'payment') {
    const payment = await tx.payment.findUniqueOrThrow({ where: { id: target.id } })
    return { accountId: payment.accountId, amount: payment.amountPaisa, direction: 'out' as const, payment }
  }
  if (target.type === 'income') {
    const income = await tx.income.findUniqueOrThrow({ where: { id: target.id } })
    return { accountId: income.accountId, amount: income.amountPaisa, direction: 'out' as const, payment: null }
  }
  const expense = await tx.expense.findUniqueOrThrow({ where: { id: target.id } })
  return { accountId: expense.accountId, amount: expense.amountPaisa, direction: 'in' as const, payment: null }
}

interface VoidArgs {
  target: Target
  requestId: string
  reason: VoidReason
  note: string | null
  voider: SessionContext['user']
  now: Date
}

// The void itself, the same however it was decided: the money moves back on the same account,
// dated today, never taking cash below zero, and a receipt's dues and fines are owed again.
async function applyVoid(tx: Db, args: VoidArgs): Promise<{ voidId: string; amount: bigint }> {
  const { target } = args
  const reversal = await reversalOf(tx, target)
  // Anything that changes what a student owes locks the student row first.
  if (reversal.payment !== null) {
    await tx.$executeRaw`SELECT id FROM students WHERE id = ${reversal.payment.studentId}::uuid FOR UPDATE`
  }
  const account = await lockAccount(tx, reversal.accountId)
  if ((await tx.voidRecord.count({ where: targetLink(target) })) > 0) {
    throw fail('ALREADY_VOIDED', { what: wordFor[target.type] })
  }
  if (reversal.direction === 'out' && account.kind === 'cash') {
    const cash = await balanceOf(tx, account.id)
    if (cash - reversal.amount < 0n) {
      throw fail('INSUFFICIENT_CASH', { balance: toPaisaNumber(cash), doing: 'void' })
    }
  }
  const voided = await tx.voidRecord.create({
    data: {
      ...targetLink(target),
      reason: args.reason,
      note: args.note,
      voidRequestId: args.requestId,
      voidedById: args.voider.id,
      voidedAt: args.now,
    },
  })
  await tx.accountEntry.create({
    data: {
      accountId: account.id,
      entryDate: toDbDate(kathmanduDate(args.now)),
      direction: reversal.direction,
      amountPaisa: reversal.amount,
      voidId: voided.id,
      createdAt: args.now,
    },
  })
  if (reversal.payment !== null) {
    await reopenDues(tx, reversal.payment)
  }
  return { voidId: voided.id, amount: reversal.amount }
}

// Only the Super Admin approves, and never a request they made themselves. A receipt keeps its
// number.
export async function approveVoid(deps: AppDeps, input: DecisionInput<VoidApproval>): Promise<VoidRequest> {
  const { params, body, session, now, computer } = input
  const note = body.note === undefined || body.note === '' ? null : body.note
  await deps.db.$transaction(async (tx) => {
    const { request, target, label } = await lockRequestAndTarget(tx, params.requestId)
    if (request.requestedById === session.user.id) {
      throw fail('OWN_VOID_REQUEST')
    }
    const voided = await applyVoid(tx, { target, requestId: request.id, reason: request.reason, note, voider: session.user, now })
    await tx.voidRequest.update({
      where: { id: request.id },
      data: { status: 'approved', decidedById: session.user.id, decidedAt: now, decisionNote: note },
    })
    const requester = await tx.user.findUniqueOrThrow({ where: { id: request.requestedById }, select: { fullName: true } })
    await writeAudit(tx, {
      at: now,
      userId: session.user.id,
      computer,
      action: 'payments.voided',
      area: target.type === 'payment' ? 'Payments' : 'Accounts',
      recordType: target.type,
      recordId: target.id,
      summary: `${session.user.fullName} voided ${label} (${formatRupees(toPaisaNumber(voided.amount))}) at the request of ${requester.fullName}`,
      after: { voidId: voided.voidId, voidRequestId: request.id, note },
    })
  })
  return readVoidRequest(deps.db, params.requestId)
}

// The Super Admin can also void in one step, with a reason. It is kept as a request and a void by
// the same person, marked direct.
export async function voidDirectly(deps: AppDeps, input: RequestVoidInput): Promise<VoidRequest> {
  const { body, session, now, computer } = input
  const target = body.target
  const requestId = await deps.db.$transaction(async (tx) => {
    const label = await lockTarget(tx, target)
    if ((await tx.voidRecord.count({ where: targetLink(target) })) > 0) {
      throw fail('ALREADY_VOIDED', { what: wordFor[target.type] })
    }
    if ((await tx.voidRequest.count({ where: { ...targetLink(target), status: 'pending' } })) > 0) {
      throw fail('VOID_REQUEST_WAITING', { what: wordFor[target.type] })
    }
    const request = await tx.voidRequest.create({
      data: {
        ...targetLink(target),
        reason: body.reason,
        details: body.details,
        status: 'approved',
        direct: true,
        requestedById: session.user.id,
        requestedAt: now,
        decidedById: session.user.id,
        decidedAt: now,
      },
    })
    const voided = await applyVoid(tx, { target, requestId: request.id, reason: body.reason, note: null, voider: session.user, now })
    await writeAudit(tx, {
      at: now,
      userId: session.user.id,
      computer,
      action: 'payments.voided',
      area: target.type === 'payment' ? 'Payments' : 'Accounts',
      recordType: target.type,
      recordId: target.id,
      summary: `Voided directly by ${session.user.fullName}: ${label} (${formatRupees(toPaisaNumber(voided.amount))})`,
      after: { voidId: voided.voidId, voidRequestId: request.id, direct: true, reason: body.reason, details: body.details },
    })
    return request.id
  })
  return readVoidRequest(deps.db, requestId)
}

export async function declineVoid(deps: AppDeps, input: DecisionInput<VoidDecline>): Promise<VoidRequest> {
  const { params, body, session, now, computer } = input
  await deps.db.$transaction(async (tx) => {
    const { request, target, label } = await lockRequestAndTarget(tx, params.requestId)
    await tx.voidRequest.update({
      where: { id: request.id },
      data: { status: 'declined', decidedById: session.user.id, decidedAt: now, decisionNote: body.note },
    })
    await writeAudit(tx, {
      at: now,
      userId: session.user.id,
      computer,
      action: 'payments.void_declined',
      area: target.type === 'payment' ? 'Payments' : 'Accounts',
      recordType: target.type,
      recordId: target.id,
      summary: `${session.user.fullName} declined the request to void ${label}`,
      after: { voidRequestId: request.id, note: body.note },
    })
  })
  return readVoidRequest(deps.db, params.requestId)
}
