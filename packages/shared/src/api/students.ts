import { z } from 'zod'

import {
  adDateSchema,
  countSchema,
  idSchema,
  paisaSchema,
  positivePaisaSchema,
  receiptNoSchema,
  recordStatusSchema,
  sessionNameSchema,
  studentRefSchema,
} from './common.ts'
import { dueItemSchema, paymentMethodSchema, receiptLineSchema } from './fees.ts'

export const studentStatusSchema = z.enum(['active', 'inactive'])

export const studentSearchQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  classId: idSchema.optional(),
  withDues: z.stringbool().optional(),
})

// What the lookup screen shows of a student, and nothing more: date of birth, address and
// attendance notes are for the Super Admin only. A student may have no guardian on record.
export const studentSummarySchema = studentRefSchema.extend({
  code: z.string(),
  rollNo: z.int().positive(),
  status: studentStatusSchema,
  guardianName: z.string().nullable(),
  guardianPhone: z.string().nullable(),
  outstanding: paisaSchema,
})

export const studentSearchResponseSchema = z.object({
  students: z.array(studentSummarySchema),
})

export const studentFeesSchema = z.object({
  student: studentSummarySchema.extend({ guardianRelationship: z.string().nullable() }),
  dues: z.array(dueItemSchema),
  paidThisSession: z.object({
    sessionName: sessionNameSchema,
    // The session's first day, for "4 receipts since Baishakh".
    since: adDateSchema,
    amount: paisaSchema,
    receiptCount: countSchema,
  }),
  payments: z.array(
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
})

export type StudentSearchQuery = z.infer<typeof studentSearchQuerySchema>
export type StudentSummary = z.infer<typeof studentSummarySchema>
export type StudentSearchResponse = z.infer<typeof studentSearchResponseSchema>
export type StudentFees = z.infer<typeof studentFeesSchema>
