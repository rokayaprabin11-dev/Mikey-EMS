import { z } from 'zod'

import { accountKindSchema, accountSchema } from './accounts.ts'
import {
  adDateSchema,
  bsMonthSchema,
  countSchema,
  idSchema,
  paisaSchema,
  recordStatusSchema,
  studentRefSchema,
  timestampSchema,
} from './common.ts'
import { paymentListItemSchema, paymentMethodSchema, voidRequestSchema } from './fees.ts'

// Money taken: the receipts that still stand (not voided), as the Payments list counts them.
const collectionSchema = z.object({
  amount: paisaSchema,
  receiptCount: countSchema,
  byMethod: z.array(z.object({ method: paymentMethodSchema, receiptCount: countSchema, amount: paisaSchema })),
})

const monthToDateSchema = z.object({ amount: paisaSchema, bsMonth: bsMonthSchema, upTo: adDateSchema })

const todaysExpenseSchema = z.object({
  id: idSchema,
  description: z.string(),
  categoryName: z.string(),
  accountKind: accountKindSchema,
  status: recordStatusSchema,
  amount: paisaSchema,
})

// "Close the day": what the drawer should hold now, and the most recent close.
const dayCloseNoteSchema = z.object({
  expectedCash: z.int(),
  last: z
    .object({ date: adDateSchema, closedAt: timestampSchema, closedBy: z.string(), difference: z.int() })
    .nullable(),
})

const moneyToday = {
  date: adDateSchema,
  // Receipts from earlier days voided today. Today's own voided receipts are already out of
  // "Collected today", so collected less these is today's fee movement in cash and bank.
  voidsToday: z.object({ amount: paisaSchema, receiptCount: countSchema }),
  collectedThisMonth: monthToDateSchema,
  feesOutstanding: z.object({ amount: paisaSchema, studentCount: countSchema }),
  spentToday: z.object({ amount: paisaSchema, entryCount: countSchema }),
  accounts: z.array(accountSchema),
  todaysExpenses: z.array(todaysExpenseSchema),
  dayClose: dayCloseNoteSchema,
  voidRequests: z.array(voidRequestSchema),
}

// The Accountant's Main screen. Latest receipts and void requests are the signed-in user's own.
export const financeDashboardSchema = z.object({
  ...moneyToday,
  collectedToday: collectionSchema.extend({ receiptCountByYou: countSchema }),
  latestReceipts: z.array(paymentListItemSchema),
  collectionByDay: z.array(z.object({ date: adDateSchema, amount: paisaSchema })),
  largestDues: z.array(
    z.object({
      student: studentRefSchema,
      amount: paisaSchema,
      items: z.array(
        z.object({ kind: z.enum(['fee', 'fine']), headName: z.string(), periodLabel: z.string(), partPaid: z.boolean() }),
      ),
    }),
  ),
})

// The money parts of the Super Admin's Main screen. Every waiting void request is listed.
export const schoolDashboardSchema = z.object({
  ...moneyToday,
  collectedToday: collectionSchema.extend({ lastAt: timestampSchema.nullable() }),
  // This month's tuition dues (fee heads of the kind monthly) after discounts, the money taken
  // against them by payments not voided, and that as a share rounded down (DOMAIN_RULES §12).
  tuitionThisMonth: z.object({ billed: paisaSchema, collected: paisaSchema, percent: z.int().min(0).max(100).nullable() }),
  incomeThisMonth: paisaSchema,
  expensesThisMonth: paisaSchema,
  collectionByMonth: z.array(z.object({ bsMonth: bsMonthSchema, amount: paisaSchema })),
  latestReceipts: z.array(paymentListItemSchema),
})

export type FinanceDashboard = z.infer<typeof financeDashboardSchema>
export type SchoolDashboard = z.infer<typeof schoolDashboardSchema>
