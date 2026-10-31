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
    discount: paisaSchema,
    paid: paisaSchema,
    remaining: positivePaisaSchema,
  }),
  z.object({
    kind: z.literal('fine'),
    fineId: idSchema,
    feeDueId: idSchema,
    headName: z.string(),
    periodLabel: z.string(),
    reason: z.string(),
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

// Everything printed on a receipt, saved when it is issued. Receipts can never be changed, so a
// receipt shows the same words and amounts for ever, whatever is renamed or edited later.
// `version` says which shape a stored snapshot has. This reader must understand version 1 for
// ever: a new shape gets a new version and its own reader, and stored snapshots are never
// rewritten (DECISIONS.md D22).
export const receiptSnapshotSchema = z
  .object({
    version: z.literal(1),
    school: z.object({
      name: z.string().min(1),
      address: z.string().nullable(),
      phone: z.string().nullable(),
      pan: z.string().nullable(),
      // Receipts print the built-in placeholder crest until uploaded logos are stored (Q9, Q22).
      logo: z.null(),
    }),
    receiptNo: receiptNoSchema,
    fiscalYear: fiscalYearSchema,
    sessionName: sessionNameSchema,
    issuedAt: timestampSchema,
    date: z.object({ ad: adDateSchema, bs: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
    student: z.object({
      code: z.string().min(1),
      fullName: z.string().min(1),
      className: z.string().min(1),
      sectionName: z.string().min(1),
      rollNo: z.int().positive(),
      guardianName: z.string().nullable(),
    }),
    months: z.string().nullable(),
    lines: z.array(z.object({ label: z.string().min(1), amount: positivePaisaSchema })).min(1),
    totals: z.object({
      duesBefore: paisaSchema,
      discount: paisaSchema,
      amountPaid: positivePaisaSchema,
      balanceAfter: paisaSchema,
    }),
    amountInWords: z.string().min(1),
    method: paymentMethodSchema,
    reference: z.string().nullable(),
    receivedBy: z.string().min(1),
  })
  .refine((snapshot) => snapshot.lines.reduce((sum, line) => sum + line.amount, 0) === snapshot.totals.amountPaid, {
    error: 'The lines do not add up to the amount paid.',
    path: ['totals', 'amountPaid'],
  })
  .refine((snapshot) => snapshot.totals.balanceAfter === snapshot.totals.duesBefore - snapshot.totals.amountPaid, {
    error: 'The balance after is not the dues before minus the amount paid.',
    path: ['totals', 'balanceAfter'],
  })
  .refine((snapshot) => snapshot.receiptNo.startsWith(`${snapshot.fiscalYear}-`), {
    error: 'The receipt number belongs to another fiscal year.',
    path: ['receiptNo'],
  })

export const receiptSchema = z.object({
  paymentId: idSchema,
  status: recordStatusSchema,
  printCount: countSchema,
  snapshot: receiptSnapshotSchema,
})

export const collectPaymentResponseSchema = z.object({
  receipt: receiptSchema,
  alreadySaved: z.boolean(),
})

// `search` matches the receipt number, or the student's name or ID.
export const paymentsListQuerySchema = z.object({
  date: adDateSchema,
  takenBy: z.enum(['me', 'everyone']).default('everyone'),
  search: z.string().trim().max(100).optional(),
  method: paymentMethodSchema.optional(),
  status: recordStatusSchema.optional(),
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

// `total` leaves out voided receipts.
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

export const voidApprovalSchema = z.object({
  note: z.string().trim().max(500).optional(),
})

export const voidDeclineSchema = z.object({
  note: z.string().trim().min(1).max(500),
})

export const originalPrintAllowanceSchema = z.object({
  reason: z.string().trim().min(1).max(500),
})

export const voidTargetSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('payment'),
    id: idSchema,
    receiptNo: receiptNoSchema,
    studentName: z.string(),
    className: z.string(),
    sectionName: z.string(),
    method: paymentMethodSchema,
    takenAt: timestampSchema,
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
export type ReceiptSnapshot = z.infer<typeof receiptSnapshotSchema>
export type Receipt = z.infer<typeof receiptSchema>
export type CollectPaymentResponse = z.infer<typeof collectPaymentResponseSchema>
export type PaymentsListQuery = z.infer<typeof paymentsListQuerySchema>
export type PaymentListItem = z.infer<typeof paymentListItemSchema>
export type PaymentsListResponse = z.infer<typeof paymentsListResponseSchema>
export type VoidReason = z.infer<typeof voidReasonSchema>
export type VoidRequestCreate = z.infer<typeof voidRequestCreateSchema>
export type VoidApproval = z.infer<typeof voidApprovalSchema>
export type VoidDecline = z.infer<typeof voidDeclineSchema>
export type OriginalPrintAllowance = z.infer<typeof originalPrintAllowanceSchema>
export type VoidRequest = z.infer<typeof voidRequestSchema>
export type VoidRequestsResponse = z.infer<typeof voidRequestsResponseSchema>
