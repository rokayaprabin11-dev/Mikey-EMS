import { type Receipt, receiptSnapshotSchema } from '@mikey/shared'

import type { RequestContext, SessionContext } from '../auth/sessions.ts'
import type { AppDeps, Db } from '../deps.ts'
import { fail } from '../errors.ts'
import { renderReceipt } from '../pdf/receipt.ts'

function statusOf(payment: { voidRecord: object | null; voidRequests: readonly object[] }): Receipt['status'] {
  if (payment.voidRecord !== null) {
    return 'voided'
  }
  return payment.voidRequests.length > 0 ? 'void_requested' : 'posted'
}

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
    status: statusOf(row.payment),
    printCount: row._count.prints,
    snapshot: receiptSnapshotSchema.parse(row.snapshot),
  }
}

interface PrintInput extends RequestContext {
  session: SessionContext
  params: { paymentId: string }
}

// The original is printed once. Every later print is a copy (`/reprint`, payments.reprint).
export async function printOriginal(deps: AppDeps, input: PrintInput): Promise<Buffer> {
  const receipt = await deps.db.receipt.findUnique({
    where: { paymentId: input.params.paymentId },
    select: { id: true, snapshot: true },
  })
  if (receipt === null) {
    throw fail('NOT_FOUND', { what: 'receipt' })
  }
  const pdf = await renderReceipt(receiptSnapshotSchema.parse(receipt.snapshot), {
    printedAt: input.now,
    computer: input.computer,
  })
  await deps.db.$transaction(async (tx) => {
    // Two counters pressing Print at the same moment must not both get the original.
    await tx.$executeRaw`SELECT id FROM receipts WHERE id = ${receipt.id}::uuid FOR UPDATE`
    if ((await tx.receiptPrint.count({ where: { receiptId: receipt.id } })) > 0) {
      throw fail('ALREADY_PRINTED')
    }
    await tx.receiptPrint.create({
      data: {
        receiptId: receipt.id,
        printNo: 1,
        computer: input.computer,
        printedById: input.session.user.id,
        printedAt: input.now,
      },
    })
  })
  return pdf
}
