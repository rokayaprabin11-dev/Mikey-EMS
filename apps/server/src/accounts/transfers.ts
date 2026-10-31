import type { Account as AccountRow } from '@mikey/db'
import { formatRupees, kathmanduDate, toPaisaNumber, type Transfer, type TransferCreate } from '@mikey/shared'

import { writeAudit } from '../audit.ts'
import type { RequestContext, SessionContext } from '../auth/sessions.ts'
import { fromDbDate, toDbDate } from '../dates.ts'
import type { AppDeps, Db } from '../deps.ts'
import { fail } from '../errors.ts'
import { balanceOf, lockAccount } from './accounts.ts'

async function readTransfer(db: Db, id: string): Promise<Transfer> {
  const account = { select: { id: true, name: true, kind: true } } as const
  const row = await db.transfer.findUniqueOrThrow({
    where: { id },
    include: { fromAccount: account, toAccount: account, enteredBy: { select: { fullName: true } } },
  })
  return {
    id: row.id,
    transferDate: fromDbDate(row.transferDate),
    from: row.fromAccount,
    to: row.toAccount,
    amount: toPaisaNumber(row.amountPaisa),
    note: row.note,
    enteredBy: row.enteredBy.fullName,
    createdAt: row.createdAt.toISOString(),
  }
}

interface TransferInput extends RequestContext {
  session: SessionContext
  body: TransferCreate
}

// Moves money between two accounts, dated today: one entry out of one, one entry into the other.
export async function createTransfer(deps: AppDeps, input: TransferInput): Promise<Transfer> {
  const { body, session, now, computer } = input
  const id = await deps.db.$transaction(async (tx) => {
    // Both accounts are locked, always in the same order, so two transfers going opposite ways
    // cannot wait on each other.
    const locked = new Map<string, AccountRow>()
    for (const accountId of [body.fromAccountId, body.toAccountId].toSorted()) {
      locked.set(accountId, await lockAccount(tx, accountId))
    }
    const from = locked.get(body.fromAccountId)
    const to = locked.get(body.toAccountId)
    if (from === undefined || to === undefined) {
      throw new Error('A locked account went missing.')
    }
    // A repeat of the same request returns what the first one saved.
    const earlier = await tx.transfer.findUnique({ where: { idempotencyKey: body.idempotencyKey }, select: { id: true } })
    if (earlier !== null) {
      return earlier.id
    }
    const amount = BigInt(body.amount)
    if (from.kind === 'cash') {
      const cash = await balanceOf(tx, from.id)
      if (amount > cash) {
        throw fail('INSUFFICIENT_CASH', { balance: toPaisaNumber(cash), doing: 'transfer' })
      }
    }
    const date = toDbDate(kathmanduDate(now))
    const note = body.note === undefined || body.note === '' ? null : body.note
    const transfer = await tx.transfer.create({
      data: {
        idempotencyKey: body.idempotencyKey,
        fromAccountId: from.id,
        toAccountId: to.id,
        transferDate: date,
        amountPaisa: amount,
        note,
        enteredById: session.user.id,
        createdAt: now,
      },
    })
    await tx.accountEntry.create({
      data: { accountId: from.id, entryDate: date, direction: 'out', amountPaisa: amount, transferId: transfer.id, createdAt: now },
    })
    await tx.accountEntry.create({
      data: { accountId: to.id, entryDate: date, direction: 'in', amountPaisa: amount, transferId: transfer.id, createdAt: now },
    })
    await writeAudit(tx, {
      at: now,
      userId: session.user.id,
      computer,
      action: 'accounts.transfer_entered',
      area: 'Accounts',
      recordType: 'transfer',
      recordId: transfer.id,
      summary: `${session.user.fullName} moved ${formatRupees(body.amount)} from ${from.name} to ${to.name}`,
      after: { fromAccountId: from.id, toAccountId: to.id, amountPaisa: body.amount, note },
    })
    return transfer.id
  })
  return readTransfer(deps.db, id)
}
