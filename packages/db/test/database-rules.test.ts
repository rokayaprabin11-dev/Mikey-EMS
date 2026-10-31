import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'

import { createDb, type PaymentMethod } from '../src/index.ts'

const db = createDb(inject('testDatabaseUrl'))

function day(ad: string): Date {
  return new Date(`${ad}T00:00:00.000Z`)
}

interface Fixture {
  userId: string
  studentId: string
  cashId: string
  bankId: string
  feeHeadId: string
  sessionId: string
  feeDueId: string
  fineId: string
  paymentId: string
  allocationId: string
  receiptId: string
  receiptPrintId: string
  allowanceId: string
  incomeCategoryId: string
  incomeId: string
  expenseCategoryId: string
  expenseId: string
  voidId: string
  transferId: string
  entryId: string
  dayCloseId: string
  dayClosePrintId: string
  auditLogId: string
}

let f: Fixture

function newPayment(overrides: { method?: PaymentMethod; reference?: string | null; amountPaisa?: bigint } = {}) {
  return db.payment.create({
    data: {
      studentId: f.studentId,
      idempotencyKey: randomUUID(),
      paidDate: day('2026-10-29'),
      method: overrides.method ?? 'cash',
      reference: overrides.reference ?? null,
      amountPaisa: overrides.amountPaisa ?? 100_000n,
      accountId: f.cashId,
      takenById: f.userId,
      computer: 1,
    },
  })
}

// A receipt that pays off everything owed. The database only checks the snapshot is an object;
// its contents are checked by receiptSnapshotSchema in packages/shared.
function receiptAmounts(amountPaisa: bigint) {
  return { amountPaisa, duesBeforePaisa: amountPaisa, discountPaisa: 0n, balanceAfterPaisa: 0n, snapshot: {} }
}

beforeAll(async () => {
  const role = await db.role.create({ data: { name: 'super_admin' } })
  const user = await db.user.create({
    data: { username: 'test.admin', passwordHash: 'not used', fullName: 'Test Admin', roleId: role.id },
  })
  const session = await db.academicSession.create({
    data: { name: '2083', startDate: day('2026-04-28'), isCurrent: true },
  })
  const student = await db.student.create({
    data: {
      studentCode: 'TEST-0001',
      fullName: 'Test Student',
      gender: 'female',
      dobDate: day('2018-05-01'),
      address: 'Banepa-7, Kavrepalanchok',
      admissionDate: day('2026-04-28'),
    },
  })
  const cash = await db.account.create({ data: { name: 'Cash in hand', kind: 'cash' } })
  const bank = await db.account.create({ data: { name: 'Current account', kind: 'bank' } })
  const feeHead = await db.feeHead.create({ data: { name: 'Monthly tuition', kind: 'monthly' } })
  const feeDue = await db.feeDue.create({
    data: {
      studentId: student.id,
      sessionId: session.id,
      feeHeadId: feeHead.id,
      periodLabel: 'Kartik 2083',
      billDate: day('2026-10-18'),
      dueDate: day('2026-11-01'),
      amountPaisa: 368_000n,
    },
  })
  const fine = await db.fine.create({ data: { feeDueId: feeDue.id, amountPaisa: 10_000n, reason: 'Late' } })

  f = { userId: user.id, studentId: student.id, cashId: cash.id, bankId: bank.id } as Fixture
  const payment = await newPayment({ amountPaisa: 378_000n })
  const allocation = await db.paymentAllocation.create({
    data: { paymentId: payment.id, feeDueId: feeDue.id, amountPaisa: 368_000n },
  })
  const receipt = await db.receipt.create({
    data: { ...receiptAmounts(378_000n), paymentId: payment.id, receiptNo: '2083/84-000001', fiscalYear: '2083/84', seq: 1 },
  })
  const receiptPrint = await db.receiptPrint.create({
    data: { receiptId: receipt.id, printNo: 1, computer: 1, printedById: user.id },
  })
  const allowance = await db.originalPrintAllowance.create({
    data: { receiptId: receipt.id, reason: 'The printer jammed on the original.', allowedById: user.id },
  })
  const incomeCategory = await db.incomeCategory.create({ data: { name: 'Bank interest' } })
  const income = await db.income.create({
    data: {
      idempotencyKey: randomUUID(),
      categoryId: incomeCategory.id,
      accountId: bank.id,
      incomeDate: day('2026-10-29'),
      amountPaisa: 124_000n,
      description: 'Interest for Ashwin',
      enteredById: user.id,
    },
  })
  const expenseCategory = await db.expenseCategory.create({ data: { name: 'Stationery and teaching' } })
  const expense = await db.expense.create({
    data: {
      idempotencyKey: randomUUID(),
      categoryId: expenseCategory.id,
      accountId: cash.id,
      expenseDate: day('2026-10-29'),
      amountPaisa: 145_000n,
      description: 'Whiteboard markers and chalk',
      enteredById: user.id,
    },
  })
  const voidedExpense = await db.expense.create({
    data: {
      idempotencyKey: randomUUID(),
      categoryId: expenseCategory.id,
      accountId: cash.id,
      expenseDate: day('2026-10-29'),
      amountPaisa: 9_000n,
      description: 'Typed twice',
      enteredById: user.id,
    },
  })
  const voidRecord = await db.voidRecord.create({
    data: { expenseId: voidedExpense.id, reason: 'wrong_amount', voidedById: user.id },
  })
  const transfer = await db.transfer.create({
    data: {
      idempotencyKey: randomUUID(),
      fromAccountId: cash.id,
      toAccountId: bank.id,
      transferDate: day('2026-10-29'),
      amountPaisa: 50_000n,
      enteredById: user.id,
    },
  })
  const entry = await db.accountEntry.create({
    data: {
      accountId: cash.id,
      entryDate: day('2026-10-29'),
      direction: 'in',
      amountPaisa: 378_000n,
      paymentId: payment.id,
    },
  })
  const dayClose = await db.dayClose.create({
    data: {
      closeDate: day('2026-10-27'),
      expectedCashPaisa: 11_234_000n,
      countedCashPaisa: 11_224_000n,
      differencePaisa: -10_000n,
      denominations: [],
      closedById: user.id,
      snapshot: {},
    },
  })
  const dayClosePrint = await db.dayClosePrint.create({
    data: { dayCloseId: dayClose.id, printNo: 1, computer: 2, printedById: user.id },
  })
  const auditLog = await db.auditLog.create({
    data: { computer: 1, action: 'test.fixture', area: 'Tests', summary: 'Fixture rows for the database rules' },
  })

  f = {
    ...f,
    feeHeadId: feeHead.id,
    sessionId: session.id,
    feeDueId: feeDue.id,
    fineId: fine.id,
    paymentId: payment.id,
    allocationId: allocation.id,
    receiptId: receipt.id,
    receiptPrintId: receiptPrint.id,
    allowanceId: allowance.id,
    incomeCategoryId: incomeCategory.id,
    incomeId: income.id,
    expenseCategoryId: expenseCategory.id,
    expenseId: expense.id,
    voidId: voidRecord.id,
    transferId: transfer.id,
    entryId: entry.id,
    dayCloseId: dayClose.id,
    dayClosePrintId: dayClosePrint.id,
    auditLogId: auditLog.id,
  }
})

afterAll(async () => {
  await db.$disconnect()
})

describe('partial unique indexes', () => {
  it('refuse a second current session', async () => {
    await expect(
      db.academicSession.create({ data: { name: '2084', startDate: day('2027-04-27'), isCurrent: true } }),
    ).rejects.toThrow(/Unique constraint/)
    await expect(
      db.academicSession.create({ data: { name: '2082', startDate: day('2025-04-28'), isCurrent: false } }),
    ).resolves.toMatchObject({ name: '2082' })
  })

  it.each(['payment', 'income', 'expense'] as const)('refuse a second pending void request for one %s', async (kind) => {
    const target =
      kind === 'payment' ? { paymentId: f.paymentId } : kind === 'income' ? { incomeId: f.incomeId } : { expenseId: f.expenseId }
    await db.voidRequest.create({
      data: { ...target, reason: 'wrong_amount', details: 'First request', requestedById: f.userId },
    })
    await expect(
      db.voidRequest.create({ data: { ...target, reason: 'other', details: 'Second request', requestedById: f.userId } }),
    ).rejects.toThrow(/Unique constraint/)
  })

  it('refuse a second pending connection request from the same IP', async () => {
    await db.connectionRequest.create({ data: { ip: '192.168.1.11', computerName: 'ACCOUNTS-PC' } })
    await expect(
      db.connectionRequest.create({ data: { ip: '192.168.1.11', computerName: 'ACCOUNTS-PC' } }),
    ).rejects.toThrow(/Unique constraint/)
    await db.connectionRequest.create({ data: { ip: '192.168.1.12', computerName: 'OLD-PC', status: 'declined' } })
    await expect(
      db.connectionRequest.create({ data: { ip: '192.168.1.12', computerName: 'OLD-PC' } }),
    ).resolves.toMatchObject({ status: 'pending' })
  })
})

describe('usernames', () => {
  it('are stored trimmed and lowercase', async () => {
    const roleId = (await db.user.findUniqueOrThrow({ where: { id: f.userId } })).roleId
    for (const username of ['Test.Upper', ' test.padded', '']) {
      await expect(
        db.user.create({ data: { username, passwordHash: 'not used', fullName: 'Test', roleId } }),
      ).rejects.toThrow(/users_username_check/)
    }
  })

  it('are unique whatever their case', async () => {
    const rows = await db.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE indexname = 'users_username_lower_key'`
    expect(rows).toEqual([{ indexdef: expect.stringMatching(/UNIQUE INDEX .* \(lower\(username\)\)/) as unknown }])
  })
})

const permanentTables = [
  ['payments', () => f.paymentId],
  ['payment_allocations', () => f.allocationId],
  ['receipts', () => f.receiptId],
  ['receipt_prints', () => f.receiptPrintId],
  ['original_print_allowances', () => f.allowanceId],
  ['voids', () => f.voidId],
  ['incomes', () => f.incomeId],
  ['expenses', () => f.expenseId],
  ['transfers', () => f.transferId],
  ['account_entries', () => f.entryId],
  ['day_closes', () => f.dayCloseId],
  ['day_close_prints', () => f.dayClosePrintId],
  ['audit_logs', () => f.auditLogId],
] as const

describe.each(permanentTables)('rows in %s are permanent', (table, rowId) => {
  it('refuses UPDATE', async () => {
    await expect(
      db.$executeRawUnsafe(`UPDATE "${table}" SET "id" = "id" WHERE "id" = $1::uuid`, rowId()),
    ).rejects.toThrow(/permanent/)
  })

  it('refuses DELETE', async () => {
    await expect(db.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "id" = $1::uuid`, rowId())).rejects.toThrow(
      /permanent/,
    )
  })

  it('refuses TRUNCATE, even with CASCADE', async () => {
    await expect(db.$executeRawUnsafe(`TRUNCATE "${table}" CASCADE`)).rejects.toThrow(/permanent/)
  })

  it('still has the row afterwards', async () => {
    const rows = await db.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*) AS count FROM "${table}" WHERE "id" = $1::uuid`,
      rowId(),
    )
    expect(rows[0]?.count).toBe(1n)
  })
})

describe('check constraints on money', () => {
  it('refuse a cash payment with a reference', async () => {
    await expect(newPayment({ method: 'cash', reference: 'V-1' })).rejects.toThrow(/payments_reference_check/)
  })

  it('refuse a non-cash payment without a reference', async () => {
    await expect(newPayment({ method: 'esewa' })).rejects.toThrow(/payments_reference_check/)
    await expect(newPayment({ method: 'esewa', reference: '   ' })).rejects.toThrow(/payments_reference_check/)
    await expect(newPayment({ method: 'esewa', reference: 'TXN-881' })).resolves.toMatchObject({ method: 'esewa' })
  })

  it('refuse a payment of zero', async () => {
    await expect(newPayment({ amountPaisa: 0n })).rejects.toThrow(/payments_amount_check/)
  })

  it('refuse an allocation that names neither or both of a due and a fine', async () => {
    await expect(
      db.paymentAllocation.create({ data: { paymentId: f.paymentId, amountPaisa: 100n } }),
    ).rejects.toThrow(/payment_allocations_one_target_check/)
    await expect(
      db.paymentAllocation.create({
        data: { paymentId: f.paymentId, feeDueId: f.feeDueId, fineId: f.fineId, amountPaisa: 100n },
      }),
    ).rejects.toThrow(/payment_allocations_one_target_check/)
  })

  it('refuse an account entry with two sources', async () => {
    await expect(
      db.accountEntry.create({
        data: {
          accountId: f.cashId,
          entryDate: day('2026-10-29'),
          direction: 'out',
          amountPaisa: 100n,
          expenseId: f.expenseId,
          transferId: f.transferId,
        },
      }),
    ).rejects.toThrow(/account_entries_one_source_check/)
  })

  it('refuse a transfer into the account it came from', async () => {
    await expect(
      db.transfer.create({
        data: {
          idempotencyKey: randomUUID(),
          fromAccountId: f.cashId,
          toAccountId: f.cashId,
          transferDate: day('2026-10-29'),
          amountPaisa: 100n,
          enteredById: f.userId,
        },
      }),
    ).rejects.toThrow(/transfers_two_accounts_check/)
  })

  it('refuse a receipt number that does not match its fiscal year and sequence', async () => {
    const payment = await newPayment()
    await expect(
      db.receipt.create({
        data: { ...receiptAmounts(100_000n), paymentId: payment.id, receiptNo: '2083/84-000009', fiscalYear: '2083/84', seq: 2 },
      }),
    ).rejects.toThrow(/receipts_number_check/)
  })

  it.each([
    ['a balance after that is not the dues before minus the amount', { duesBeforePaisa: 150_000n, balanceAfterPaisa: 0n }],
    ['dues before smaller than the amount', { duesBeforePaisa: 50_000n, balanceAfterPaisa: -50_000n }],
    ['a negative discount', { discountPaisa: -1n }],
  ])('refuse a receipt with %s', async (_case, amounts) => {
    const payment = await newPayment()
    await expect(
      db.receipt.create({
        data: { ...receiptAmounts(100_000n), ...amounts, paymentId: payment.id, receiptNo: '2083/84-000020', fiscalYear: '2083/84', seq: 20 },
      }),
    ).rejects.toThrow(/receipts_amounts_check/)
  })

  it('refuse a receipt for a different amount than its payment', async () => {
    const payment = await newPayment({ amountPaisa: 100_000n })
    await expect(
      db.receipt.create({
        data: { ...receiptAmounts(90_000n), paymentId: payment.id, receiptNo: '2083/84-000021', fiscalYear: '2083/84', seq: 21 },
      }),
    ).rejects.toThrow(/Foreign key constraint/)
  })

  it('refuse an allowance for one more original without a reason', async () => {
    await expect(
      db.originalPrintAllowance.create({ data: { receiptId: f.receiptId, reason: '  ', allowedById: f.userId } }),
    ).rejects.toThrow(/original_print_allowances_reason_check/)
  })

  it('refuse two prints that use the same allowance', async () => {
    await db.receiptPrint.create({
      data: { receiptId: f.receiptId, printNo: 2, computer: 2, printedById: f.userId, allowanceId: f.allowanceId },
    })
    await expect(
      db.receiptPrint.create({
        data: { receiptId: f.receiptId, printNo: 3, computer: 2, printedById: f.userId, allowanceId: f.allowanceId },
      }),
    ).rejects.toThrow(/Unique constraint/)
  })

  it('refuse a snapshot that is not an object', async () => {
    const payment = await newPayment()
    await expect(
      db.receipt.create({
        data: {
          ...receiptAmounts(100_000n),
          snapshot: ['not', 'an', 'object'],
          paymentId: payment.id,
          receiptNo: '2083/84-000022',
          fiscalYear: '2083/84',
          seq: 22,
        },
      }),
    ).rejects.toThrow(/receipts_snapshot_check/)
  })

  it('refuse a day close whose difference is not counted minus expected', async () => {
    await expect(
      db.dayClose.create({
        data: {
          closeDate: day('2026-10-28'),
          expectedCashPaisa: 11_234_000n,
          countedCashPaisa: 11_224_000n,
          differencePaisa: 10_000n,
          denominations: [],
          closedById: f.userId,
          snapshot: {},
        },
      }),
    ).rejects.toThrow(/day_closes_amounts_check/)
  })

  it('refuse a day-close snapshot that is not an object', async () => {
    await expect(
      db.dayClose.create({
        data: {
          closeDate: day('2026-10-26'),
          expectedCashPaisa: 0n,
          countedCashPaisa: 0n,
          differencePaisa: 0n,
          denominations: [],
          closedById: f.userId,
          snapshot: 'not an object',
        },
      }),
    ).rejects.toThrow(/day_closes_snapshot_check/)
  })

  it('refuse a day-close print numbered zero', async () => {
    await expect(
      db.dayClosePrint.create({ data: { dayCloseId: f.dayCloseId, printNo: 0, computer: 1, printedById: f.userId } }),
    ).rejects.toThrow(/day_close_prints_print_no_check/)
  })

  it('refuse a discount larger than the due', async () => {
    await expect(
      db.feeDue.create({
        data: {
          studentId: f.studentId,
          sessionId: f.sessionId,
          feeHeadId: f.feeHeadId,
          periodLabel: 'Mangsir 2083',
          billDate: day('2026-11-17'),
          dueDate: day('2026-12-01'),
          amountPaisa: 100_000n,
          discountPaisa: 100_001n,
        },
      }),
    ).rejects.toThrow(/fee_dues_amounts_check/)
  })
})
