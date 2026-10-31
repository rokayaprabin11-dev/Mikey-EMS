import { z } from 'zod'

import {
  adDateSchema,
  bsMonthSchema,
  countSchema,
  idempotencyKeySchema,
  idSchema,
  paisaSchema,
  positivePaisaSchema,
  printedDateSchema,
  printedSchoolSchema,
  receiptNoSchema,
  recordStatusSchema,
  timestampSchema,
} from './common.ts'
import { paymentMethodSchema, voidReasonSchema } from './fees.ts'

export const accountKindSchema = z.enum(['cash', 'bank'])

export const accountRefSchema = z.object({
  id: idSchema,
  name: z.string(),
  kind: accountKindSchema,
})

// A balance can be below zero: a bank expense is not limited by the balance, and opening balances
// are not entered yet (Q20).
const balanceSchema = z.int()

export const accountSchema = accountRefSchema.extend({
  bankName: z.string().nullable(),
  accountNoLast4: z.string().regex(/^\d{4}$/).nullable(),
  balance: balanceSchema,
  belowZero: z.boolean(),
})

export const accountsResponseSchema = z.object({
  accounts: z.array(accountSchema),
})

export const categoriesResponseSchema = z.object({
  categories: z.array(z.object({ id: idSchema, name: z.string(), isActive: z.boolean() })),
})

export const moneyEntryCreateSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  categoryId: idSchema,
  accountId: idSchema,
  amount: positivePaisaSchema,
  description: z.string().trim().min(1).max(200),
  voucherNo: z.string().trim().min(1).max(50).optional(),
})

export const moneyEntrySchema = z.object({
  id: idSchema,
  entryDate: adDateSchema,
  description: z.string(),
  category: z.object({ id: idSchema, name: z.string() }),
  account: accountRefSchema,
  voucherNo: z.string().nullable(),
  amount: positivePaisaSchema,
  status: recordStatusSchema,
  enteredBy: z.string(),
  createdAt: timestampSchema,
})

export const moneyEntryListQuerySchema = z.object({
  bsMonth: bsMonthSchema,
})

export const moneyEntryListResponseSchema = z.object({
  entries: z.array(moneyEntrySchema),
  total: paisaSchema,
  byCategory: z.array(z.object({ categoryId: idSchema, name: z.string(), amount: paisaSchema })),
})

export const transferCreateSchema = z
  .object({
    idempotencyKey: idempotencyKeySchema,
    fromAccountId: idSchema,
    toAccountId: idSchema,
    amount: positivePaisaSchema,
    note: z.string().trim().max(200).optional(),
  })
  .refine((transfer) => transfer.fromAccountId !== transfer.toAccountId, {
    error: 'Money must move to a different account.',
    path: ['toAccountId'],
  })

export const transferSchema = z.object({
  id: idSchema,
  transferDate: adDateSchema,
  from: accountRefSchema,
  to: accountRefSchema,
  amount: positivePaisaSchema,
  note: z.string().nullable(),
  enteredBy: z.string(),
  createdAt: timestampSchema,
})

// What a void reverses, as the cashbook and the day-close summary name it.
const voidTargetTextSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('payment'), receiptNo: receiptNoSchema }),
  z.object({ type: z.literal('income'), description: z.string() }),
  z.object({ type: z.literal('expense'), description: z.string() }),
])

const bookEntrySourceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('payment'), paymentId: idSchema, receiptNo: receiptNoSchema, studentName: z.string() }),
  z.object({
    type: z.literal('income'),
    incomeId: idSchema,
    description: z.string(),
    categoryName: z.string(),
    voucherNo: z.string().nullable(),
    enteredBy: z.string(),
  }),
  z.object({
    type: z.literal('expense'),
    expenseId: idSchema,
    description: z.string(),
    categoryName: z.string(),
    voucherNo: z.string().nullable(),
    enteredBy: z.string(),
  }),
  z.object({
    type: z.literal('transfer'),
    transferId: idSchema,
    otherAccountName: z.string(),
    note: z.string().nullable(),
  }),
  z.object({
    type: z.literal('void'),
    voidId: idSchema,
    target: voidTargetTextSchema,
    reason: voidReasonSchema,
    approvedBy: z.string(),
  }),
])

export const bookEntrySchema = z.object({
  id: idSchema,
  at: timestampSchema,
  direction: z.enum(['in', 'out']),
  amount: positivePaisaSchema,
  balance: balanceSchema,
  source: bookEntrySourceSchema,
})

export const bookQuerySchema = z.object({
  date: adDateSchema,
})

export const bookResponseSchema = z.object({
  account: accountRefSchema,
  date: adDateSchema,
  openingBalance: balanceSchema,
  entries: z.array(bookEntrySchema),
  totals: z.object({ moneyIn: paisaSchema, moneyOut: paisaSchema }),
  closingBalance: balanceSchema,
  // On the cashbook of a closed day: when it was closed and how many entries were made after.
  dayClose: z.object({ closedAt: timestampSchema, entriesAfter: countSchema }).nullable(),
})

export const CASH_DENOMINATIONS = [1000, 500, 100, 50, 20, 10, 5, 2] as const

const noteCountSchema = z.object({
  note: z.literal([...CASH_DENOMINATIONS]),
  count: countSchema,
})

export const dayCloseCreateSchema = z.object({
  counts: z
    .array(noteCountSchema)
    .min(1)
    .refine((counts) => new Set(counts.map((item) => item.note)).size === counts.length, {
      error: 'Each note is counted once.',
    }),
  note: z.string().trim().max(500).optional(),
})

export const dayCloseSchema = z.object({
  id: idSchema,
  closeDate: adDateSchema,
  expectedCash: paisaSchema,
  countedCash: paisaSchema,
  difference: z.int(),
  counts: z.array(noteCountSchema),
  note: z.string().nullable(),
  closedBy: z.string(),
  closedAt: timestampSchema,
})

export const dayCloseStatusSchema = z.object({
  date: adDateSchema,
  expectedCash: balanceSchema,
  dayClose: dayCloseSchema.nullable(),
})

export const dayClosesResponseSchema = z.object({
  dayCloses: z.array(dayCloseSchema),
})

const categoryTotalSchema = z.object({ name: z.string().min(1), amount: positivePaisaSchema })

// Everything the day-close summary prints, taken when the day is closed. Every print is drawn from
// it alone, and version 1 is read for ever, as with receipts (DECISIONS.md D22).
export const dayCloseSnapshotSchema = z
  .object({
    version: z.literal(1),
    school: printedSchoolSchema,
    date: printedDateSchema,
    closedAt: timestampSchema,
    closedBy: z.string().min(1),
    counts: z.array(noteCountSchema).min(1),
    countedCash: paisaSchema,
    expectedCash: paisaSchema,
    difference: z.int(),
    note: z.string().nullable(),
    // The day's receipts, including any voided the same day; each void is listed under voids.
    feesByMethod: z.array(
      z.object({ method: paymentMethodSchema, receiptCount: z.int().positive(), amount: positivePaisaSchema }),
    ),
    incomeByCategory: z.array(categoryTotalSchema),
    expensesByCategory: z.array(categoryTotalSchema),
    voids: z.array(
      z.object({
        target: voidTargetTextSchema,
        accountName: z.string().min(1),
        amount: positivePaisaSchema,
        reason: voidReasonSchema,
        voidedBy: z.string().min(1),
      }),
    ),
  })
  .refine(
    (snapshot) => snapshot.countedCash === snapshot.counts.reduce((sum, item) => sum + item.note * 100 * item.count, 0),
    { error: 'The counted notes do not add up to the counted cash.', path: ['countedCash'] },
  )
  .refine((snapshot) => snapshot.difference === snapshot.countedCash - snapshot.expectedCash, {
    error: 'The difference is not the counted cash minus the expected cash.',
    path: ['difference'],
  })

export type AccountKind = z.infer<typeof accountKindSchema>
export type Account = z.infer<typeof accountSchema>
export type AccountsResponse = z.infer<typeof accountsResponseSchema>
export type CategoriesResponse = z.infer<typeof categoriesResponseSchema>
export type MoneyEntryCreate = z.infer<typeof moneyEntryCreateSchema>
export type MoneyEntry = z.infer<typeof moneyEntrySchema>
export type MoneyEntryListResponse = z.infer<typeof moneyEntryListResponseSchema>
export type TransferCreate = z.infer<typeof transferCreateSchema>
export type Transfer = z.infer<typeof transferSchema>
export type BookEntry = z.infer<typeof bookEntrySchema>
export type BookResponse = z.infer<typeof bookResponseSchema>
export type DayCloseCreate = z.infer<typeof dayCloseCreateSchema>
export type DayClose = z.infer<typeof dayCloseSchema>
export type DayCloseStatus = z.infer<typeof dayCloseStatusSchema>
export type DayClosesResponse = z.infer<typeof dayClosesResponseSchema>
export type DayCloseSnapshot = z.infer<typeof dayCloseSnapshotSchema>
