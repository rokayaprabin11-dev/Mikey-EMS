import type { AttendanceStatus } from '@mikey/db'
import { type AdDate, type AttendanceState, type AttendanceSummary, kathmanduClock, kathmanduDate } from '@mikey/shared'

import { toDbDate } from '../dates.ts'
import type { Db } from '../deps.ts'
import { LATEST_ENROLLMENTS } from '../students/lookup.ts'
import { pulledDevices, pullTimes } from '../system/health.ts'

// DOMAIN_RULES.md §8: the attendance day closes at 4:00 PM unless the attendance rules say otherwise.
const DEFAULT_DAY_CLOSE = '16:00'

type ClassCounts = AttendanceSummary['classes'][number]

interface Counts {
  onTime: number
  late: number
  leftEarly: number
  incomplete: number
  onLeave: number
  absent: number
  notScannedYet: number
}

// Which count a student's status for the day goes into. Only a computed or corrected absence is
// counted absent, and only once the day has closed: before that, it and a student with no status
// have not scanned yet, and no data is never turned into an absence. On a holiday nobody is
// expected.
function countFor(status: AttendanceStatus | undefined, state: AttendanceState, holiday: boolean): keyof Counts | null {
  switch (status) {
    case 'P':
      return 'onTime'
    case 'L':
      return 'late'
    case 'E':
      return 'leftEarly'
    case 'I':
      return 'incomplete'
    case 'LV':
      return 'onLeave'
    case 'H':
      return null
    case 'A':
      if (holiday || state === 'not_computed') {
        return null
      }
      return state === 'closed' ? 'absent' : 'notScannedYet'
    default:
      return holiday || state === 'not_computed' ? null : 'notScannedYet'
  }
}

// Counts per class for one day, from the computed statuses and the corrections over them. Counts
// only: no student is named.
export async function attendanceSummary(db: Db, date: AdDate, now: Date): Promise<AttendanceSummary> {
  const rule = await db.attendanceRule.findUnique({ where: { appliesTo: 'student' }, select: { dayCloseTime: true } })
  const dayClosesAt = rule?.dayCloseTime ?? DEFAULT_DAY_CLOSE
  const today = kathmanduDate(now)
  const day = toDbDate(date)
  const holiday = await db.holiday.findUnique({ where: { dayDate: day }, select: { name: true } })
  const students = await db.$queryRaw<{ student_id: string; class_id: string; class_name: string }[]>`
    WITH latest AS (${LATEST_ENROLLMENTS})
    SELECT s.id AS student_id, c.id AS class_id, c.name AS class_name
    FROM students s
    JOIN latest l ON l.student_id = s.id
    JOIN sections sec ON sec.id = l.section_id
    JOIN classes c ON c.id = sec.class_id
    WHERE s.status = 'active'
    ORDER BY c.sort_order, c.name`
  const computed = await db.attendanceDay.findMany({
    where: { personType: 'student', dayDate: day },
    select: { personId: true, computedStatus: true, firstInAt: true, lastOutAt: true },
  })
  const corrections = await db.attendanceCorrection.findMany({
    where: { personType: 'student', dayDate: day },
    orderBy: [{ correctedAt: 'asc' }, { id: 'asc' }],
    select: { personId: true, status: true },
  })

  // Statuses only say who was there once they rest on scans from a device.
  const scanned = computed.some((row) => row.firstInAt !== null || row.lastOutAt !== null)
  const dayClosed = date < today || (date === today && kathmanduClock(now) >= dayClosesAt)
  let state: AttendanceState = 'open'
  if (!scanned) {
    state = 'not_computed'
  } else if (dayClosed) {
    state = 'closed'
  }

  // A correction overrides the computed status, and a later correction an earlier one.
  const statusOf = new Map<string, AttendanceStatus>(computed.map((row) => [row.personId, row.computedStatus]))
  for (const correction of corrections) {
    statusOf.set(correction.personId, correction.status)
  }
  const classes = new Map<string, { classId: string; className: string; students: number } & Counts>()
  for (const student of students) {
    const counts = classes.get(student.class_id) ?? {
      classId: student.class_id,
      className: student.class_name,
      students: 0,
      onTime: 0,
      late: 0,
      leftEarly: 0,
      incomplete: 0,
      onLeave: 0,
      absent: 0,
      notScannedYet: 0,
    }
    counts.students += 1
    const count = countFor(statusOf.get(student.student_id), state, holiday !== null)
    if (count !== null) {
      counts[count] += 1
    }
    classes.set(student.class_id, counts)
  }
  return {
    date,
    holidayName: holiday?.name ?? null,
    dayClosesAt,
    state,
    lastScansPulledAt: pullTimes(await pulledDevices(db)).lastSyncAt,
    classes: [...classes.values()].map(
      (counts): ClassCounts =>
        state === 'not_computed' ? { ...counts, absent: null, notScannedYet: null } : counts,
    ),
  }
}
