import {
  adToBs,
  amountInWords,
  fiscalYearOf,
  formatBsDate,
  kathmanduDate,
  printEn,
  type Receipt,
  type ReceiptSnapshot,
  receiptSnapshotSchema,
  schoolProfileSchema,
} from '@mikey/shared'

import { writeAudit } from '../audit.ts'
import type { RequestContext, SessionContext } from '../auth/sessions.ts'
import type { AppDeps, Db } from '../deps.ts'
import { fail } from '../errors.ts'
import { renderReceipt } from '../pdf/receipt.ts'
import { recordStatus } from '../record-status.ts'
import { readSetting } from '../settings.ts'

const words = printEn.receipt

export async function readReceipt(db: Db, paymentId: string): Promise<Receipt> {
  const row = await db.receipt.findUnique({
    where: { paymentId },
    select: {
      snapshot: true,
      _count: { select: { prints: true } },
      payment: {
        select: {
          voidRecord: { select: { id: true } },
          voidRequests: { where: { status: 'pending' }, select: { id: true } },
        },
      },
    },
  })
  if (row === null) {
    throw fail('NOT_FOUND', { what: 'receipt' })
  }
  return {
    paymentId,
    status: recordStatus(row.payment),
    printCount: row._count.prints,
    snapshot: receiptSnapshotSchema.parse(row.snapshot),
  }
}

interface ReceiptInput extends RequestContext {
  session: SessionContext
  params: { paymentId: string }
}

// Prints and allowances of one receipt happen one at a time: each locks the receipt row first.
async function lockReceipt(tx: Db, paymentId: string): Promise<{ id: string; snapshot: ReceiptSnapshot }> {
  await tx.$executeRaw`SELECT id FROM receipts WHERE payment_id = ${paymentId}::uuid FOR UPDATE`
  const receipt = await tx.receipt.findUnique({ where: { paymentId }, select: { id: true, snapshot: true } })
  if (receipt === null) {
    throw fail('NOT_FOUND', { what: 'receipt' })
  }
  return { id: receipt.id, snapshot: receiptSnapshotSchema.parse(receipt.snapshot) }
}

async function printNumbers(tx: Db, receiptId: string): Promise<number[]> {
  const prints = await tx.receiptPrint.findMany({ where: { receiptId }, select: { printNo: true } })
  return prints.map((print) => print.printNo)
}

async function isVoided(tx: Db, paymentId: string): Promise<boolean> {
  return (await tx.voidRecord.count({ where: { paymentId } })) > 0
}

// The original is printed once. One more original needs the Super Admin's allowance; every other
// print is a copy (`/reprint`).
export function printOriginal(deps: AppDeps, input: ReceiptInput): Promise<Buffer> {
  const { params, session, now, computer } = input
  return deps.db.$transaction(async (tx) => {
    const receipt = await lockReceipt(tx, params.paymentId)
    const printed = await printNumbers(tx, receipt.id)
    let allowanceId: string | null = null
    if (printed.length > 0) {
      const allowance = await tx.originalPrintAllowance.findFirst({
        where: { receiptId: receipt.id, print: { is: null } },
        orderBy: [{ allowedAt: 'asc' }, { id: 'asc' }],
        select: { id: true },
      })
      if (allowance === null) {
        throw fail('ALREADY_PRINTED')
      }
      allowanceId = allowance.id
    }
    const voided = await isVoided(tx, params.paymentId)
    const pdf = await renderReceipt(receipt.snapshot, { printedAt: now, computer, copy: null, voided, test: false })
    await tx.receiptPrint.create({
      data: {
        receiptId: receipt.id,
        printNo: Math.max(0, ...printed) + 1,
        computer,
        printedById: session.user.id,
        printedAt: now,
        allowanceId,
      },
    })
    return pdf
  })
}

// Any receipt can be copied any number of times. A copy is a new receipt_prints row; the receipt
// itself never changes.
export function reprint(deps: AppDeps, input: ReceiptInput): Promise<Buffer> {
  const { params, session, now, computer } = input
  return deps.db.$transaction(async (tx) => {
    const receipt = await lockReceipt(tx, params.paymentId)
    const printed = await printNumbers(tx, receipt.id)
    if (printed.length === 0) {
      throw fail('ORIGINAL_NOT_PRINTED')
    }
    const printNo = Math.max(...printed) + 1
    const voided = await isVoided(tx, params.paymentId)
    const pdf = await renderReceipt(receipt.snapshot, { printedAt: now, computer, copy: printNo, voided, test: false })
    await tx.receiptPrint.create({
      data: { receiptId: receipt.id, printNo, computer, printedById: session.user.id, printedAt: now },
    })
    return pdf
  })
}

// When the original was sent but the printer failed, the Super Admin allows one more original.
export async function allowOriginal(deps: AppDeps, input: ReceiptInput & { body: { reason: string } }): Promise<void> {
  const { params, body, session, now, computer } = input
  await deps.db.$transaction(async (tx) => {
    const receipt = await lockReceipt(tx, params.paymentId)
    if ((await printNumbers(tx, receipt.id)).length === 0) {
      throw fail('ORIGINAL_NOT_PRINTED')
    }
    if ((await tx.originalPrintAllowance.count({ where: { receiptId: receipt.id, print: { is: null } } })) > 0) {
      throw fail('ORIGINAL_ALREADY_ALLOWED')
    }
    const allowance = await tx.originalPrintAllowance.create({
      data: { receiptId: receipt.id, reason: body.reason, allowedById: session.user.id, allowedAt: now },
    })
    await writeAudit(tx, {
      at: now,
      userId: session.user.id,
      computer,
      action: 'receipts.original_allowed',
      area: 'Payments',
      recordType: 'receipt',
      recordId: receipt.id,
      summary: `${session.user.fullName} allowed one more original of receipt ${receipt.snapshot.receiptNo}`,
      after: { allowanceId: allowance.id, reason: body.reason },
    })
  })
}

// The receipt's page with a sample line and a large TEST across it, to check the printer and the
// paper. It is not a receipt: nothing is saved and no receipt number is used.
export async function printTestReceipt(deps: AppDeps, input: RequestContext & { session: SessionContext }): Promise<Buffer> {
  const { session, now, computer } = input
  const school = await readSetting(deps.db, 'school.profile', schoolProfileSchema)
  if (school === null) {
    throw fail('SCHOOL_NOT_SET_UP', { making: 'receipts' })
  }
  const current = await deps.db.academicSession.findFirst({ where: { isCurrent: true }, select: { name: true } })
  const today = kathmanduDate(now)
  const amount = 100_000
  const snapshot: ReceiptSnapshot = {
    version: 1,
    school: { name: school.name, address: school.address, phone: school.phone, pan: school.pan, logo: null },
    receiptNo: words.testMark,
    fiscalYear: fiscalYearOf(adToBs(today)),
    sessionName: current?.name ?? words.testMark,
    issuedAt: now.toISOString(),
    date: { ad: today, bs: formatBsDate(adToBs(today)) },
    student: { code: words.testMark, fullName: words.testStudent, className: words.testMark, sectionName: '', rollNo: 1, guardianName: null },
    months: null,
    lines: [{ label: words.testLine, amount }],
    totals: { duesBefore: amount, discount: 0, amountPaid: amount, balanceAfter: 0 },
    amountInWords: amountInWords(amount),
    method: 'cash',
    reference: null,
    receivedBy: session.user.fullName,
  }
  return renderReceipt(snapshot, { printedAt: now, computer, copy: null, voided: false, test: true })
}

