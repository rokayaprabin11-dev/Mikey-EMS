import { z } from 'zod'

import { adDateSchema, countSchema, paisaSchema, positivePaisaSchema, receiptNoSchema, timestampSchema } from './common.ts'
import { paymentMethodSchema, voidReasonSchema } from './fees.ts'

export const REPORT_TYPES = ['fee_collection', 'dues', 'expenses', 'day_closes'] as const

export const reportTypeSchema = z.enum(REPORT_TYPES)

export const reportQuerySchema = z
  .object({ type: reportTypeSchema, from: adDateSchema, to: adDateSchema })
  .refine((query) => query.from <= query.to, { error: 'The end date is before the start date.', path: ['to'] })

const reportHeaderSchema = z.object({
  schoolName: z.string(),
  from: adDateSchema,
  to: adDateSchema,
  generatedAt: timestampSchema,
  generatedBy: z.string(),
})

// Each receipt and each void of a receipt in the period, on the day its cash or bank entry is
// dated, in the order they were made. A void is its own line, so the totals match the cashbook.
const feeCollectionRowSchema = z.object({
  kind: z.enum(['receipt', 'void']),
  date: adDateSchema,
  at: timestampSchema,
  receiptNo: receiptNoSchema,
  studentName: z.string(),
  className: z.string(),
  sectionName: z.string(),
  method: paymentMethodSchema,
  accountName: z.string(),
  amount: positivePaisaSchema,
  // On a void line: why, and who voided it.
  reason: voidReasonSchema.nullable(),
  voidedBy: z.string().nullable(),
})

// One row per class: the dues billed in the period (with their fines), and what is still owed on
// them now.
const duesRowSchema = z.object({
  className: z.string(),
  studentsBilled: countSchema,
  studentsOwing: countSchema,
  billed: paisaSchema,
  paid: paisaSchema,
  outstanding: paisaSchema,
})

// Each expense and each void of an expense in the period, like the fee collection lines.
const expenseRowSchema = z.object({
  kind: z.enum(['expense', 'void']),
  date: adDateSchema,
  at: timestampSchema,
  categoryName: z.string(),
  description: z.string(),
  voucherNo: z.string().nullable(),
  accountName: z.string(),
  amount: positivePaisaSchema,
  reason: voidReasonSchema.nullable(),
  voidedBy: z.string().nullable(),
})

const dayCloseRowSchema = z.object({
  date: adDateSchema,
  closedAt: timestampSchema,
  closedBy: z.string(),
  expectedCash: paisaSchema,
  countedCash: paisaSchema,
  difference: z.int(),
  note: z.string().nullable(),
})

export const reportSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('fee_collection'),
    header: reportHeaderSchema,
    rows: z.array(feeCollectionRowSchema),
    // Net is received less voided, and can be below zero when earlier receipts were voided.
    totals: z.object({ received: paisaSchema, voided: paisaSchema, net: z.int() }),
  }),
  z.object({
    type: z.literal('dues'),
    header: reportHeaderSchema,
    rows: z.array(duesRowSchema),
    totals: duesRowSchema.omit({ className: true }),
  }),
  z.object({
    type: z.literal('expenses'),
    header: reportHeaderSchema,
    rows: z.array(expenseRowSchema),
    // The same lines added up for each category, by name.
    byCategory: z.array(z.object({ name: z.string(), spent: paisaSchema, voided: paisaSchema })),
    totals: z.object({ spent: paisaSchema, voided: paisaSchema, net: z.int() }),
  }),
  z.object({
    type: z.literal('day_closes'),
    header: reportHeaderSchema,
    rows: z.array(dayCloseRowSchema),
    totals: z.object({ short: paisaSchema, over: paisaSchema }),
  }),
])

export type ReportQuery = z.infer<typeof reportQuerySchema>
export type ReportType = z.infer<typeof reportTypeSchema>
export type Report = z.infer<typeof reportSchema>
