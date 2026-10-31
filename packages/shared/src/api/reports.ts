import { z } from 'zod'

import { accountRefSchema, bookEntrySchema } from './accounts.ts'
import {
  adDateSchema,
  bsMonthSchema,
  countSchema,
  fiscalYearSchema,
  idSchema,
  paisaSchema,
  positivePaisaSchema,
  receiptNoSchema,
  recordStatusSchema,
  sessionNameSchema,
  timestampSchema,
} from './common.ts'
import { paymentMethodSchema, receiptLineSchema } from './fees.ts'

const dateRange = {
  from: adDateSchema,
  to: adDateSchema,
}

function rangeInOrder(range: { from: string; to: string }): boolean {
  return range.from <= range.to
}

const rangeError = { error: 'The end date is before the start date.', path: ['to'] }

export const reportQuerySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('daily_collection'), date: adDateSchema }),
  z.object({ type: z.literal('monthly_collection'), bsMonth: bsMonthSchema }),
  z
    .object({
      type: z.literal('yearly_collection'),
      session: sessionNameSchema.optional(),
      fiscalYear: fiscalYearSchema.optional(),
    })
    .refine((query) => (query.session === undefined) !== (query.fiscalYear === undefined), {
      error: 'Choose a session or a fiscal year.',
    }),
  z.object({
    type: z.literal('outstanding_fees'),
    asOf: adDateSchema,
    session: sessionNameSchema,
    classId: idSchema.optional(),
    sectionId: idSchema.optional(),
  }),
  z.object({ type: z.literal('student_payment_history'), studentId: idSchema, session: sessionNameSchema.optional() }),
  z.object({ type: z.literal('income'), ...dateRange }).refine(rangeInOrder, rangeError),
  z.object({ type: z.literal('expenses'), ...dateRange }).refine(rangeInOrder, rangeError),
  z.object({ type: z.literal('cashbook'), accountId: idSchema, ...dateRange }).refine(rangeInOrder, rangeError),
  z.object({ type: z.literal('bankbook'), accountId: idSchema, ...dateRange }).refine(rangeInOrder, rangeError),
  z.object({ type: z.literal('financial_summary'), ...dateRange }).refine(rangeInOrder, rangeError),
])

const reportHeaderSchema = z.object({
  schoolName: z.string(),
  generatedAt: timestampSchema,
  generatedBy: z.string(),
})

const collectionRowSchema = z.object({ receiptCount: countSchema, amount: paisaSchema })

const moneyEntryRowSchema = z.object({
  id: idSchema,
  date: adDateSchema,
  description: z.string(),
  categoryName: z.string(),
  accountName: z.string(),
  voucherNo: z.string().nullable(),
  status: recordStatusSchema,
  amount: positivePaisaSchema,
})

const categoryTotalSchema = z.object({ name: z.string(), amount: paisaSchema })

const bookReportSchema = {
  header: reportHeaderSchema,
  account: accountRefSchema,
  ...dateRange,
  openingBalance: paisaSchema,
  entries: z.array(bookEntrySchema),
  totals: z.object({ moneyIn: paisaSchema, moneyOut: paisaSchema }),
  closingBalance: paisaSchema,
}

export const reportSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('daily_collection'),
    header: reportHeaderSchema,
    date: adDateSchema,
    rows: z.array(
      z.object({
        paymentId: idSchema,
        receiptNo: receiptNoSchema,
        takenAt: timestampSchema,
        takenBy: z.string(),
        studentName: z.string(),
        className: z.string(),
        sectionName: z.string(),
        method: paymentMethodSchema,
        status: recordStatusSchema,
        amount: positivePaisaSchema,
      }),
    ),
    totalsByMethod: z.array(z.object({ method: paymentMethodSchema, receiptCount: countSchema, amount: paisaSchema })),
    total: paisaSchema,
  }),
  z.object({
    type: z.literal('monthly_collection'),
    header: reportHeaderSchema,
    bsMonth: bsMonthSchema,
    rows: z.array(collectionRowSchema.extend({ date: adDateSchema })),
    total: paisaSchema,
  }),
  z.object({
    type: z.literal('yearly_collection'),
    header: reportHeaderSchema,
    session: sessionNameSchema.nullable(),
    fiscalYear: fiscalYearSchema.nullable(),
    rows: z.array(collectionRowSchema.extend({ bsMonth: bsMonthSchema })),
    total: paisaSchema,
  }),
  z.object({
    type: z.literal('outstanding_fees'),
    header: reportHeaderSchema,
    asOf: adDateSchema,
    session: sessionNameSchema,
    rows: z.array(
      z.object({
        classId: idSchema,
        className: z.string(),
        sectionId: idSchema.nullable(),
        sectionName: z.string().nullable(),
        students: countSchema,
        studentsWithDues: countSchema,
        billedSoFar: paisaSchema,
        outstanding: paisaSchema,
      }),
    ),
  }),
  z.object({
    type: z.literal('student_payment_history'),
    header: reportHeaderSchema,
    student: z.object({
      id: idSchema,
      code: z.string(),
      fullName: z.string(),
      className: z.string(),
      sectionName: z.string(),
      rollNo: z.int().positive(),
    }),
    rows: z.array(
      z.object({
        paymentId: idSchema,
        paidDate: adDateSchema,
        receiptNo: receiptNoSchema,
        method: paymentMethodSchema,
        status: recordStatusSchema,
        amount: positivePaisaSchema,
        lines: z.array(receiptLineSchema),
      }),
    ),
    total: paisaSchema,
  }),
  z.object({
    type: z.literal('income'),
    header: reportHeaderSchema,
    ...dateRange,
    rows: z.array(moneyEntryRowSchema),
    byCategory: z.array(categoryTotalSchema),
    total: paisaSchema,
  }),
  z.object({
    type: z.literal('expenses'),
    header: reportHeaderSchema,
    ...dateRange,
    rows: z.array(moneyEntryRowSchema),
    byCategory: z.array(categoryTotalSchema),
    total: paisaSchema,
  }),
  z.object({ type: z.literal('cashbook'), ...bookReportSchema }),
  z.object({ type: z.literal('bankbook'), ...bookReportSchema }),
  z.object({
    type: z.literal('financial_summary'),
    header: reportHeaderSchema,
    ...dateRange,
    income: z.array(categoryTotalSchema),
    expenses: z.array(categoryTotalSchema),
    totalIncome: paisaSchema,
    totalExpenses: paisaSchema,
    net: z.int(),
  }),
])

export type ReportQuery = z.infer<typeof reportQuerySchema>
export type ReportType = ReportQuery['type']
export type Report = z.infer<typeof reportSchema>
