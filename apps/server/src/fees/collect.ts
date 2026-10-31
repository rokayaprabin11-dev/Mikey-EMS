import {
  adToBs,
  buildReceiptSnapshot,
  type CollectPaymentRequest,
  type CollectPaymentResponse,
  fiscalYearOf,
  formatRupees,
  kathmanduDate,
  type PaymentMethod,
  type ReceiptLineInput,
  schoolProfileSchema,
  toPaisaNumber,
} from '@mikey/shared'

import { writeAudit } from '../audit.ts'
import type { RequestContext, SessionContext } from '../auth/sessions.ts'
import { toDbDate } from '../dates.ts'
import type { AppDeps, Db } from '../deps.ts'
import { errors } from '../errors.ts'
import { readSetting } from '../settings.ts'
import { readLedger, type StudentLedger } from './ledger.ts'
import { readReceipt } from './receipts.ts'

interface CollectInput extends RequestContext {
  session: SessionContext
  body: CollectPaymentRequest
}

interface Plan {
  allocations: { feeDueId: string | null; fineId: string | null; amountPaisa: bigint }[]
  lines: ReceiptLineInput[]
  paidDues: { id: string; settled: boolean }[]
  discount: bigint
}

function checkAmount(label: string, owed: boolean, remaining: bigint, amount: bigint): void {
  if (!owed) {
    throw errors.dueNotOwed(label)
  }
  if (remaining === 0n) {
    throw errors.dueAlreadyPaid(label)
  }
  if (amount > remaining) {
    throw errors.amountExceedsDue(label, toPaisaNumber(amount), toPaisaNumber(remaining))
  }
}

function plan(ledger: StudentLedger, requested: CollectPaymentRequest['allocations']): Plan {
  const result: Plan = { allocations: [], lines: [], paidDues: [], discount: 0n }
  for (const item of requested) {
    const amount = BigInt(item.amount)
    if (item.kind === 'fee') {
      const due = ledger.feeDues.find((row) => row.id === item.feeDueId)
      if (due === undefined) {
        throw errors.dueNotFound()
      }
      checkAmount(`${due.headName}, ${due.periodLabel}`, due.owed, due.remaining, amount)
      const settled = amount === due.remaining
      result.allocations.push({ feeDueId: due.id, fineId: null, amountPaisa: amount })
      result.lines.push({
        kind: 'fee',
        headName: due.headName,
        monthly: due.monthly,
        periodLabel: due.periodLabel,
        billDate: due.billDate,
        amount: item.amount,
        wasPartPaid: due.paid > 0n,
        clearsDue: settled,
      })
      result.paidDues.push({ id: due.id, settled })
      result.discount += due.discount
    } else {
      const fine = ledger.fines.find((row) => row.id === item.fineId)
      if (fine === undefined) {
        throw errors.dueNotFound()
      }
      checkAmount(fine.reason, fine.owed, fine.remaining, amount)
      result.allocations.push({ feeDueId: null, fineId: fine.id, amountPaisa: amount })
      result.lines.push({ kind: 'fine', reason: fine.reason, amount: item.amount })
    }
  }
  return result
}

// Cash goes into the one cash account and every other method into the one bank account. With
// none, or more than one, this version cannot choose, so it says so instead of guessing.
async function receivingAccount(tx: Db, method: PaymentMethod): Promise<string> {
  const kind = method === 'cash' ? 'cash' : 'bank'
  const accounts = await tx.account.findMany({ where: { kind }, select: { id: true }, take: 2 })
  const [account] = accounts
  if (account !== undefined && accounts.length === 1) {
    return account.id
  }
  if (kind === 'cash') {
    throw errors.accountNotSetUp(
      account === undefined
        ? 'There is no cash account on Computer 1. Ask the Super Admin to set one up.'
        : 'Computer 1 has more than one cash account, so this version cannot choose one. Ask the Super Admin.',
    )
  }
  throw errors.accountNotSetUp(
    account === undefined
      ? 'There is no bank account on Computer 1 for this payment. Ask the Super Admin to add one, or take cash.'
      : 'Computer 1 has more than one bank account, so this version cannot choose which one this payment goes into. Ask the Super Admin.',
  )
}

export async function collectPayment(deps: AppDeps, input: CollectInput): Promise<CollectPaymentResponse> {
  const { body, session, now, computer } = input
  const paidDate = kathmanduDate(now)
  const fiscalYear = fiscalYearOf(adToBs(paidDate))

  const saved = await deps.db.$transaction(async (tx) => {
    // Every payment in a fiscal year waits here for the one before it, so receipt numbers have no
    // gaps and each payment reads the dues after the one before it was saved.
    await tx.$executeRaw`INSERT INTO receipt_counters (fiscal_year) VALUES (${fiscalYear}) ON CONFLICT (fiscal_year) DO NOTHING`
    const [counter] = await tx.$queryRaw<{ last_seq: number }[]>`
      SELECT last_seq FROM receipt_counters WHERE fiscal_year = ${fiscalYear} FOR UPDATE`
    if (counter === undefined) {
      throw new Error(`The receipt counter for ${fiscalYear} is missing.`)
    }

    const earlier = await tx.payment.findUnique({ where: { idempotencyKey: body.idempotencyKey }, select: { id: true } })
    if (earlier !== null) {
      return { paymentId: earlier.id, alreadySaved: true }
    }

    // Anything that changes what a student owes locks the student row first.
    const [locked] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM students WHERE id = ${body.studentId}::uuid FOR UPDATE`
    if (locked === undefined) {
      throw errors.notFound('This student')
    }

    const ledger = await readLedger(tx, body.studentId)
    const planned = plan(ledger, body.allocations)
    const accountId = await receivingAccount(tx, body.method)
    const school = await readSetting(tx, 'school.profile', schoolProfileSchema)
    if (school === null) {
      throw errors.schoolNotSetUp()
    }
    const student = await tx.student.findUniqueOrThrow({
      where: { id: body.studentId },
      include: { guardians: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 1 } },
    })
    const enrollment = await tx.studentEnrollment.findFirst({
      where: { studentId: body.studentId },
      orderBy: { session: { startDate: 'desc' } },
      include: { session: true, section: { include: { schoolClass: true } } },
    })
    if (enrollment === null) {
      throw errors.studentNotInClass()
    }

    const seq = counter.last_seq + 1
    const receiptNo = `${fiscalYear}-${String(seq).padStart(6, '0')}`
    const amount = planned.allocations.reduce((sum, allocation) => sum + allocation.amountPaisa, 0n)
    const reference = body.reference ?? null
    const className = enrollment.section.schoolClass.name
    const sectionName = enrollment.section.name
    const snapshot = buildReceiptSnapshot({
      school,
      receiptNo,
      sessionName: enrollment.session.name,
      issuedAt: now,
      paidDate,
      student: {
        code: student.studentCode,
        fullName: student.fullName,
        className,
        sectionName,
        rollNo: enrollment.rollNo,
        guardianName: student.guardians[0]?.fullName ?? null,
      },
      lines: planned.lines,
      duesBefore: toPaisaNumber(ledger.outstanding),
      discount: toPaisaNumber(planned.discount),
      method: body.method,
      reference,
      receivedBy: session.user.fullName,
    })

    const payment = await tx.payment.create({
      data: {
        studentId: body.studentId,
        idempotencyKey: body.idempotencyKey,
        paidDate: toDbDate(paidDate),
        method: body.method,
        reference,
        amountPaisa: amount,
        accountId,
        takenById: session.user.id,
        computer,
        createdAt: now,
      },
    })
    await tx.paymentAllocation.createMany({
      data: planned.allocations.map((allocation) => ({ ...allocation, paymentId: payment.id, createdAt: now })),
    })
    await tx.receipt.create({
      data: {
        paymentId: payment.id,
        receiptNo,
        fiscalYear,
        seq,
        amountPaisa: amount,
        duesBeforePaisa: ledger.outstanding,
        discountPaisa: planned.discount,
        balanceAfterPaisa: ledger.outstanding - amount,
        snapshot,
        createdAt: now,
      },
    })
    await tx.receiptCounter.update({ where: { fiscalYear }, data: { lastSeq: seq } })
    await tx.accountEntry.create({
      data: {
        accountId,
        entryDate: toDbDate(paidDate),
        direction: 'in',
        amountPaisa: amount,
        paymentId: payment.id,
        createdAt: now,
      },
    })
    for (const due of planned.paidDues) {
      await tx.feeDue.update({
        where: { id: due.id },
        data: { status: due.settled ? 'paid' : 'part_paid', version: { increment: 1 } },
      })
    }
    await writeAudit(tx, {
      at: now,
      userId: session.user.id,
      computer,
      action: 'fees.payment_collected',
      area: 'Fees',
      recordType: 'payment',
      recordId: payment.id,
      summary: `Collected ${formatRupees(toPaisaNumber(amount))} from ${student.fullName} (${className} ${sectionName}), receipt ${receiptNo}`,
      after: { receiptNo, amountPaisa: toPaisaNumber(amount), method: body.method },
    })
    return { paymentId: payment.id, alreadySaved: false }
  })

  return { receipt: await readReceipt(deps.db, saved.paymentId), alreadySaved: saved.alreadySaved }
}
