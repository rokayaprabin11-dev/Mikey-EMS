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

import { onlyAccount } from '../accounts/accounts.ts'
import { writeAudit } from '../audit.ts'
import type { RequestContext, SessionContext } from '../auth/sessions.ts'
import { toDbDate } from '../dates.ts'
import type { AppDeps, Db } from '../deps.ts'
import { fail } from '../errors.ts'
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
    throw fail('DUE_NOT_OWED', { item: label })
  }
  if (remaining === 0n) {
    throw fail('DUE_ALREADY_PAID', { item: label })
  }
  if (amount > remaining) {
    const params = { item: label, amount: toPaisaNumber(amount), remaining: toPaisaNumber(remaining) }
    throw fail('AMOUNT_EXCEEDS_DUE', params).withDetails({ remaining: params.remaining })
  }
}

function plan(ledger: StudentLedger, requested: CollectPaymentRequest['allocations']): Plan {
  const result: Plan = { allocations: [], lines: [], paidDues: [], discount: 0n }
  for (const item of requested) {
    const amount = BigInt(item.amount)
    if (item.kind === 'fee') {
      const due = ledger.feeDues.find((row) => row.id === item.feeDueId)
      if (due === undefined) {
        throw fail('NOT_FOUND', { what: 'due' })
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
        throw fail('NOT_FOUND', { what: 'due' })
      }
      checkAmount(fine.reason, fine.owed, fine.remaining, amount)
      result.allocations.push({ feeDueId: null, fineId: fine.id, amountPaisa: amount })
      result.lines.push({ kind: 'fine', reason: fine.reason, amount: item.amount })
    }
  }
  return result
}

// Cash goes into the one cash account and every other method into the one bank account.
async function receivingAccount(tx: Db, method: PaymentMethod): Promise<string> {
  return (await onlyAccount(tx, method === 'cash' ? 'cash' : 'bank')).id
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
      throw fail('NOT_FOUND', { what: 'student' })
    }

    const ledger = await readLedger(tx, body.studentId)
    const planned = plan(ledger, body.allocations)
    const accountId = await receivingAccount(tx, body.method)
    const school = await readSetting(tx, 'school.profile', schoolProfileSchema)
    if (school === null) {
      throw fail('SCHOOL_NOT_SET_UP', { making: 'receipts' })
    }
    // One table per query, one query after another (CLAUDE.md).
    const student = await tx.student.findUniqueOrThrow({
      where: { id: body.studentId },
      select: { studentCode: true, fullName: true },
    })
    const guardian = await tx.guardian.findFirst({
      where: { studentId: body.studentId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { fullName: true },
    })
    const enrollment = await tx.studentEnrollment.findFirst({
      where: { studentId: body.studentId },
      orderBy: { session: { startDate: 'desc' } },
      select: { rollNo: true, sessionId: true, sectionId: true },
    })
    if (enrollment === null) {
      throw fail('STUDENT_NOT_IN_CLASS')
    }
    const academicSession = await tx.academicSession.findUniqueOrThrow({
      where: { id: enrollment.sessionId },
      select: { name: true },
    })
    const section = await tx.section.findUniqueOrThrow({
      where: { id: enrollment.sectionId },
      select: { name: true, classId: true },
    })
    const schoolClass = await tx.schoolClass.findUniqueOrThrow({ where: { id: section.classId }, select: { name: true } })

    const seq = counter.last_seq + 1
    const receiptNo = `${fiscalYear}-${String(seq).padStart(6, '0')}`
    const amount = planned.allocations.reduce((sum, allocation) => sum + allocation.amountPaisa, 0n)
    const reference = body.reference ?? null
    const className = schoolClass.name
    const sectionName = section.name
    const snapshot = buildReceiptSnapshot({
      school,
      receiptNo,
      sessionName: academicSession.name,
      issuedAt: now,
      paidDate,
      student: {
        code: student.studentCode,
        fullName: student.fullName,
        className,
        sectionName,
        rollNo: enrollment.rollNo,
        guardianName: guardian?.fullName ?? null,
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
