import { z } from 'zod'

import { adDateSchema, countSchema, idSchema, timestampSchema } from './common.ts'

export const attendanceSummaryQuerySchema = z.object({
  date: adDateSchema,
})

export const attendanceSummarySchema = z.object({
  date: adDateSchema,
  holidayName: z.string().nullable(),
  dayClosesAt: z.string().regex(/^\d{2}:\d{2}$/),
  dayClosed: z.boolean(),
  lastScansPulledAt: timestampSchema.nullable(),
  classes: z.array(
    z.object({
      classId: idSchema,
      className: z.string(),
      students: countSchema,
      onTime: countSchema,
      late: countSchema,
      leftEarly: countSchema,
      incomplete: countSchema,
      onLeave: countSchema,
      absent: countSchema,
      notScannedYet: countSchema,
    }),
  ),
})

export type AttendanceSummary = z.infer<typeof attendanceSummarySchema>
