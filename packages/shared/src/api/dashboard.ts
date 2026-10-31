import { z } from 'zod'

import { accountKindSchema } from './accounts.ts'
import { adDateSchema, bsMonthSchema, countSchema, idSchema, paisaSchema, studentRefSchema, timestampSchema } from './common.ts'
import { paymentListItemSchema, voidRequestSchema } from './fees.ts'

export const financeDashboardSchema = z.object({
  date: adDateSchema,
  collectedToday: z.object({ amount: paisaSchema, receiptCount: countSchema, receiptCountByYou: countSchema }),
  collectedThisMonth: z.object({ amount: paisaSchema, bsMonth: bsMonthSchema, upTo: adDateSchema }),
  feesOutstanding: z.object({ amount: paisaSchema, studentCount: countSchema }),
  spentToday: z.object({ amount: paisaSchema, entryCount: countSchema }),
  cashInHand: paisaSchema,
  bankAccounts: z.array(z.object({ id: idSchema, name: z.string(), balance: paisaSchema })),
  latestReceipts: z.array(paymentListItemSchema),
  collectionByDay: z.array(z.object({ date: adDateSchema, amount: paisaSchema })),
  largestDues: z.array(
    z.object({
      student: studentRefSchema,
      amount: paisaSchema,
      items: z.array(z.object({ headName: z.string(), periodLabel: z.string(), partPaid: z.boolean() })),
    }),
  ),
  todaysExpenses: z.array(
    z.object({
      id: idSchema,
      description: z.string(),
      categoryName: z.string(),
      accountKind: accountKindSchema,
      amount: paisaSchema,
    }),
  ),
  dayClose: z.object({ expectedCash: paisaSchema, closedAt: timestampSchema.nullable() }),
  voidRequests: z.array(voidRequestSchema),
})

export type FinanceDashboard = z.infer<typeof financeDashboardSchema>
