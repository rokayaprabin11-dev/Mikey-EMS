import { z } from 'zod'

import { FIRST_BS_YEAR, LAST_BS_YEAR } from '../date.ts'
import { errorCodeSchema } from '../errors.ts'

export const idSchema = z.uuid()
export const idempotencyKeySchema = z.uuid()
export const adDateSchema = z.iso.date()
export const timestampSchema = z.iso.datetime({ offset: true })
export const paisaSchema = z.int().nonnegative()
export const positivePaisaSchema = z.int().positive()
export const countSchema = z.int().nonnegative()

export const ipSchema = z.union([z.ipv4(), z.ipv6()])

export const receiptNoSchema = z.string().regex(/^\d{4}\/\d{2}-\d{6}$/)
export const sessionNameSchema = z.string().regex(/^\d{4}$/)

const FISCAL_YEAR_PATTERN = /^(\d{4})\/(\d{2})$/
export const fiscalYearSchema = z.string().refine((value) => {
  const match = FISCAL_YEAR_PATTERN.exec(value)
  return match !== null && (Number(match[1]) + 1) % 100 === Number(match[2])
}, 'A fiscal year looks like 2083/84.')

const BS_MONTH_PATTERN = /^(\d{4})-(\d{2})$/
export const bsMonthSchema = z.string().refine((value) => {
  const match = BS_MONTH_PATTERN.exec(value)
  if (match === null) {
    return false
  }
  const year = Number(match[1])
  const month = Number(match[2])
  return year >= FIRST_BS_YEAR && year <= LAST_BS_YEAR && month >= 1 && month <= 12
}, 'A BS month looks like 2083-07.')

export const recordStatusSchema = z.enum(['posted', 'void_requested', 'voided'])
export type RecordStatus = z.infer<typeof recordStatusSchema>

// The school as a printed document shows it, kept in the document's snapshot.
export const printedSchoolSchema = z.object({
  name: z.string().min(1),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  pan: z.string().nullable(),
  // Documents print the built-in placeholder crest until uploaded logos are stored (Q9, Q22).
  logo: z.null(),
})

// A day as a printed document shows it: the AD date and the same day in BS.
export const printedDateSchema = z.object({ ad: adDateSchema, bs: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })

export const studentRefSchema = z.object({
  id: idSchema,
  fullName: z.string(),
  className: z.string(),
  sectionName: z.string(),
})

export type StudentRef = z.infer<typeof studentRefSchema>

export const errorBodySchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    details: z.record(z.string(), z.unknown()),
  }),
})

export type ErrorBody = z.infer<typeof errorBodySchema>
