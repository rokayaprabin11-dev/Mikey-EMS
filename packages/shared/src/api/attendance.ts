import { z } from 'zod'

import { adDateSchema, countSchema, idSchema, timestampSchema } from './common.ts'

export const attendanceSummaryQuerySchema = z.object({
  date: adDateSchema,
})

// not_computed: no statuses have been computed for the day, or the day has no scans from any
// device, so nothing says who was there; absent and not scanned yet are then not counted (null).
// open: statuses are in, and the day has not closed. closed: the day has closed.
export const attendanceStateSchema = z.enum(['not_computed', 'open', 'closed'])

export const attendanceSummarySchema = z.object({
  date: adDateSchema,
  holidayName: z.string().nullable(),
  dayClosesAt: z.string().regex(/^\d{2}:\d{2}$/),
  state: attendanceStateSchema,
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
      absent: countSchema.nullable(),
      notScannedYet: countSchema.nullable(),
    }),
  ),
})

export type AttendanceState = z.infer<typeof attendanceStateSchema>
export type AttendanceSummary = z.infer<typeof attendanceSummarySchema>
