import type { Prisma } from '@mikey/db'
import {
  type AdDate,
  adToBs,
  type DayClose,
  type DayCloseCreate,
  dayCloseCreateSchema,
  type DayClosesResponse,
  type DayCloseStatus,
  formatBsDateLong,
  formatRupees,
  kathmanduDate,
  toPaisaNumber,
} from '@mikey/shared'

import { writeAudit } from '../audit.ts'
import type { RequestContext, SessionContext } from '../auth/sessions.ts'
import { fromDbDate, toDbDate } from '../dates.ts'
import type { AppDeps, Db } from '../deps.ts'
import { fail } from '../errors.ts'
import { balanceOf, lockAccount, onlyAccount } from './accounts.ts'

const closedBy = { closedBy: { select: { fullName: true } } } satisfies Prisma.DayCloseInclude

function toDayClose(row: Prisma.DayCloseGetPayload<{ include: typeof closedBy }>): DayClose {
  return {
    id: row.id,
    closeDate: fromDbDate(row.closeDate),
    expectedCash: toPaisaNumber(row.expectedCashPaisa),
    countedCash: toPaisaNumber(row.countedCashPaisa),
    difference: toPaisaNumber(row.differencePaisa),
    counts: dayCloseCreateSchema.shape.counts.parse(row.denominations),
    note: row.note,
    closedBy: row.closedBy.fullName,
    closedAt: row.closedAt.toISOString(),
  }
}

// What the cashbook says the drawer should hold at the end of a day, and the close if there is one.
export async function dayCloseStatus(db: Db, date: AdDate): Promise<DayCloseStatus> {
  const cash = await onlyAccount(db, 'cash')
  const expected = await balanceOf(db, cash.id, { through: date })
  const row = await db.dayClose.findUnique({ where: { closeDate: toDbDate(date) }, include: closedBy })
  return { date, expectedCash: toPaisaNumber(expected), dayClose: row === null ? null : toDayClose(row) }
}

export async function listDayCloses(db: Db): Promise<DayClosesResponse> {
  const rows = await db.dayClose.findMany({ include: closedBy, orderBy: { closeDate: 'desc' } })
  return { dayCloses: rows.map(toDayClose) }
}

interface CloseInput extends RequestContext {
  session: SessionContext
  body: DayCloseCreate
}

// Records today's drawer count against the cashbook. Closing a day does not lock it (Q14).
export async function closeDay(deps: AppDeps, input: CloseInput): Promise<DayClose> {
  const { body, session, now, computer } = input
  const today = kathmanduDate(now)
  const id = await deps.db.$transaction(async (tx) => {
    // Holding the cash account keeps money from leaving the drawer while it is counted.
    const cash = await lockAccount(tx, (await onlyAccount(tx, 'cash')).id)
    if ((await tx.dayClose.count({ where: { closeDate: toDbDate(today) } })) > 0) {
      throw fail('DAY_ALREADY_CLOSED')
    }
    const expected = await balanceOf(tx, cash.id, { through: today })
    if (expected < 0n) {
      throw fail('CASH_BELOW_ZERO', { short: toPaisaNumber(-expected) })
    }
    const counted = body.counts.reduce((sum, item) => sum + BigInt(item.note) * 100n * BigInt(item.count), 0n)
    const note = body.note === undefined || body.note === '' ? null : body.note
    const row = await tx.dayClose.create({
      data: {
        closeDate: toDbDate(today),
        expectedCashPaisa: expected,
        countedCashPaisa: counted,
        differencePaisa: counted - expected,
        denominations: body.counts,
        note,
        closedById: session.user.id,
        closedAt: now,
      },
    })
    await writeAudit(tx, {
      at: now,
      userId: session.user.id,
      computer,
      action: 'accounts.day_closed',
      area: 'Accounts',
      recordType: 'day_close',
      recordId: row.id,
      summary: `${session.user.fullName} closed ${formatBsDateLong(adToBs(today))}: counted ${formatRupees(toPaisaNumber(counted))}, cashbook ${formatRupees(toPaisaNumber(expected))}`,
      after: { expectedCash: toPaisaNumber(expected), countedCash: toPaisaNumber(counted), note },
    })
    return row.id
  })
  return toDayClose(await deps.db.dayClose.findUniqueOrThrow({ where: { id }, include: closedBy }))
}
