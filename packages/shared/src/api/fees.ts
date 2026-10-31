import { z } from 'zod'

import {
  adDateSchema,
  countSchema,
  fiscalYearSchema,
  idempotencyKeySchema,
  idSchema,
  paisaSchema,
  positivePaisaSchema,
  receiptNoSchema,
  recordStatusSchema,
  sessionNameSchema,
  studentRefSchema,
  timestampSchema,
} from './common.ts'

export const PAYMENT_METHODS = ['cash', 'bank_deposit', 'cheque', 'fonepay', 'esewa', 'khalti'] as const
export const paymentMethodSchema = z.enum(PAYMENT_METHODS)

export const dueItemSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('fee'),
    feeDueId: idSchema,
    headName: z.string(),
    periodLabel: z.string(),
    dueDate: adDateSchema,
    amount: paisaSchema,
    paid: paisaSchema,
    remaining: positivePaisaSchema,
  }),
  z.object({
    kind: z.literal('fine'),
    fineId: idSchema,
    feeDueId: idSchema,
    headName: z.string(),
    periodLabel: z.string(),
    amount: positivePaisaSchema,
    remaining: positivePaisaSchema,
  }),
])

export const studentDuesResponseSchema = z.object({
  studentId: idSchema,
  items: z.array(dueItemSchema),
  total: paisaSchema,
})

const allocationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('fee'), feeDueId: idSchema, amount: positivePaisaSchema }),
  z.object({ kind: z.literal('fine'), fineId: idSchema, amount: positivePaisaSchema }),
])

export const collectPaymentRequestSchema = z
  .object({
    idempotencyKey: idempotencyKeySchema,
    studentId: idSchema,
    method: paymentMethodSchema,
    reference: z.string().trim().min(1).max(100).optional(),
    allocations: z.array(allocationSchema).min(1),
  })
  .refine((payment) => payment.method !== 'cash' || payment.reference === undefined, {
    error: 'A cash payment has no reference number.',
    path: ['reference'],
  })
  .refine((payment) => payment.method === 'cash' || payment.reference !== undefined, {
    error: 'This payment method needs a reference number.',
    path: ['reference'],
  })
  .refine(
    (payment) => {
      const targets = payment.allocations.map((item) => (item.kind === 'fee' ? item.feeDueId : item.fineId))
      return new Set(targets).size === targets.length
    },
    { error: 'The same due is listed twice.', path: ['allocations'] },
  )

export const receiptLineSchema = z.object({
  kind: z.enum(['fee', 'fine']),
  headName: z.string(),
  periodLabel: z.string(),
  amount: positivePaisaSchema,
  wasPartPaid: z.boolean(),
  clearsDue: z.boolean(),
})

export const receiptSchema = z.object({
  paymentId: idSchema,
  receiptNo: receiptNoSchema,
  fiscalYear: fiscalYearSchema,
  sessionName: sessionNameSchema,
  issuedAt: timestampSchema,
  paidDate: adDateSchema,
  student: studentRefSchema.extend({
    code: z.string(),
    rollNo: z.int().positive(),
    guardianName: z.string(),
  }),
  lines: z.array(receiptLineSchema).min(1),
  duesBefore: paisaSchema,
  discount: paisaSchema,
  amountPaid: positivePaisaSchema,
  balanceAfter: paisaSchema,
  method: paymentMethodSchema,
  reference: z.string().nullable(),
  receivedBy: z.string(),
  computer: z.literal([1, 2]),
  status: recordStatusSchema,
  printCount: countSchema,
})

export const collectPaymentResponseSchema = z.object({
  receipt: receiptSchema,
  alreadySaved: z.boolean(),
})

export const paymentsListQuerySchema = z.object({
  date: adDateSchema,
  takenBy: z.enum(['me', 'everyone']).default('everyone'),
  search: z.string().trim().max(100).optional(),
})

export const paymentListItemSchema = z.object({
  paymentId: idSchema,
  receiptNo: receiptNoSchema,
  takenAt: timestampSchema,
  takenBy: z.string(),
  student: studentRefSchema,
  method: paymentMethodSchema,
  status: recordStatusSchema,
  amount: positivePaisaSchema,
})

export const paymentsListResponseSchema = z.object({
  payments: z.array(paymentListItemSchema),
  total: paisaSchema,
})

export const VOID_REASONS = ['wrong_student', 'wrong_amount', 'wrong_method', 'other'] as const
export const voidReasonSchema = z.enum(VOID_REASONS)

export const voidTargetTypeSchema = z.enum(['payment', 'income', 'expense'])

export const voidRequestCreateSchema = z.object({
  target: z.object({ type: voidTargetTypeSchema, id: idSchema }),
  reason: voidReasonSchema,
  details: z.string().trim().min(1).max(500),
})

export const voidTargetSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('payment'),
    id: idSchema,
    receiptNo: receiptNoSchema,
    studentName: z.string(),
    amount: positivePaisaSchema,
  }),
  z.object({ type: z.literal('income'), id: idSchema, description: z.string(), amount: positivePaisaSchema }),
  z.object({ type: z.literal('expense'), id: idSchema, description: z.string(), amount: positivePaisaSchema }),
])

export const voidRequestSchema = z.object({
  id: idSchema,
  target: voidTargetSchema,
  reason: voidReasonSchema,
  details: z.string(),
  status: z.enum(['pending', 'approved', 'declined']),
  requestedAt: timestampSchema,
  requestedBy: z.string(),
  decidedAt: timestampSchema.nullable(),
  decidedBy: z.string().nullable(),
  decisionNote: z.string().nullable(),
})

export const voidRequestsResponseSchema = z.object({
  voidRequests: z.array(voidRequestSchema),
})

export type PaymentMethod = z.infer<typeof paymentMethodSchema>
export type DueItem = z.infer<typeof dueItemSchema>
export type StudentDuesResponse = z.infer<typeof studentDuesResponseSchema>
export type CollectPaymentRequest = z.infer<typeof collectPaymentRequestSchema>
export type ReceiptLine = z.infer<typeof receiptLineSchema>
export type Receipt = z.infer<typeof receiptSchema>
export type CollectPaymentResponse = z.infer<typeof collectPaymentResponseSchema>
export type PaymentsListQuery = z.infer<typeof paymentsListQuerySchema>
export type PaymentListItem = z.infer<typeof paymentListItemSchema>
export type PaymentsListResponse = z.infer<typeof paymentsListResponseSchema>
export type VoidReason = z.infer<typeof voidReasonSchema>
export type VoidRequestCreate = z.infer<typeof voidRequestCreateSchema>
export type VoidRequest = z.infer<typeof voidRequestSchema>
export type VoidRequestsResponse = z.infer<typeof voidRequestsResponseSchema>
