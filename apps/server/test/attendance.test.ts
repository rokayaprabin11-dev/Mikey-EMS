import type { AttendanceStatus, User } from '@mikey/db'
import { type AttendanceSummary, attendanceSummarySchema } from '@mikey/shared'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  allowComputer,
  createStudent,
  createUser,
  ensureSchool,
  errorOf,
  type School,
  signIn,
  startTestServer,
  type TestServer,
} from './support.ts'

// The Accountant works on Computer 2; the Super Admin on Computer 1.
const COUNTER = '192.168.1.86'
// The test clock starts at 10:00 AM on 14 Kartik 2083 (31 Oct 2026).
const TODAY = '2026-10-31'
const YESTERDAY = '2026-10-30'

const server: TestServer = startTestServer()
let school: School
let admin: User
let accountant: User
let accountantToken: string

beforeAll(async () => {
  school = await ensureSchool(server.db)
  admin = await createUser(server.db, 'super_admin')
  accountant = await createUser(server.db, 'accountant')
  await allowComputer(server.db, COUNTER, admin)
})

beforeEach(async () => {
  accountantToken = await signIn(server, accountant, COUNTER)
})

afterAll(() => server.close())

// Statuses that rest on a scan from a device; the others (absent, leave, holiday) have none.
const SCANNED: readonly AttendanceStatus[] = ['P', 'L', 'E', 'I']

// A class of its own for each test, with one student for each status given (undefined: no
// status computed yet).
async function classWith(name: string, statuses: readonly (AttendanceStatus | undefined)[], date: string) {
  const schoolClass = await server.db.schoolClass.create({ data: { name, sortOrder: 20 } })
  const section = await server.db.section.create({ data: { classId: schoolClass.id, name: 'A', sortOrder: 1 } })
  const students = []
  for (const status of statuses) {
    const student = await createStudent(server.db, { ...school, sectionId: section.id }, `Student of ${name}`)
    if (status !== undefined) {
      await server.db.attendanceDay.create({
        data: {
          personType: 'student',
          personId: student.id,
          dayDate: new Date(`${date}T00:00:00.000Z`),
          computedStatus: status,
          firstInAt: SCANNED.includes(status) ? new Date(`${date}T09:50:00+05:45`) : null,
        },
      })
    }
    students.push(student)
  }
  return { classId: schoolClass.id, students }
}

// Moves the clock to a time on TODAY in Kathmandu, and signs in again for the new time.
async function at(time: string) {
  server.advanceMinutes((new Date(`${TODAY}T${time}:00+05:45`).getTime() - server.now().getTime()) / 60_000)
  accountantToken = await signIn(server, accountant, COUNTER)
}

function correct(studentId: string, date: string, status: AttendanceStatus) {
  server.advanceMinutes(1)
  return server.db.attendanceCorrection.create({
    data: {
      personType: 'student',
      personId: studentId,
      dayDate: new Date(`${date}T00:00:00.000Z`),
      status,
      reason: 'Seen in class; the device missed the scan.',
      correctedById: admin.id,
      correctedAt: server.now(),
    },
  })
}

async function summary(date: string): Promise<AttendanceSummary> {
  const response = await server.call({ method: 'GET', path: `/attendance/summary?date=${date}`, token: accountantToken, ip: COUNTER })
  expect(response.statusCode, response.body).toBe(200)
  return attendanceSummarySchema.parse(response.json())
}

function countsOf(result: AttendanceSummary, classId: string) {
  const row = result.classes.find((item) => item.classId === classId)
  if (row === undefined) {
    throw new Error(`Class ${classId} is not in the summary.`)
  }
  const { students, onTime, late, leftEarly, incomplete, onLeave, absent, notScannedYet } = row
  return { students, onTime, late, leftEarly, incomplete, onLeave, absent, notScannedYet }
}

describe('the attendance summary', () => {
  it('an attendance summary before day close shows no absentees', async () => {
    const { classId } = await classWith('Class 1', ['P', 'L', 'I', 'LV', 'A', undefined], TODAY)
    const result = await summary(TODAY)
    expect(result).toMatchObject({ date: TODAY, dayClosesAt: '16:00', state: 'open', holidayName: null })
    expect(countsOf(result, classId)).toEqual({
      students: 6,
      onTime: 1,
      late: 1,
      leftEarly: 0,
      incomplete: 1,
      onLeave: 1,
      absent: 0,
      notScannedYet: 2,
    })
    expect(result.classes.every((row) => row.absent === 0)).toBe(true)
  })

  it('counts a computed or corrected absence as absent once the day has closed, never a student with no status, and corrections win', async () => {
    const { classId, students } = await classWith('Class 2', ['P', 'A', undefined, 'L', 'A'], YESTERDAY)
    const [, , , late, absent] = students
    await correct(late?.id ?? '', YESTERDAY, 'LV')
    await correct(late?.id ?? '', YESTERDAY, 'P')
    await correct(absent?.id ?? '', YESTERDAY, 'LV')

    const result = await summary(YESTERDAY)
    expect(result.state).toBe('closed')
    expect(countsOf(result, classId)).toEqual({
      students: 5,
      onTime: 2,
      late: 0,
      leftEarly: 0,
      incomplete: 0,
      onLeave: 1,
      absent: 1,
      notScannedYet: 1,
    })
  })

  it('says not_computed, with no absent count, until statuses are computed or when no device has a scan that day', async () => {
    const nothing = await summary('2026-10-25')
    expect(nothing.state).toBe('not_computed')
    expect(nothing.classes.length).toBeGreaterThan(0)
    expect(nothing.classes.every((row) => row.absent === null && row.notScannedYet === null)).toBe(true)

    // Statuses computed for a day when no device sent a scan say nothing about who was there.
    const noScans = '2026-10-26'
    const { classId, students } = await classWith('Class 6', ['A', 'A', undefined], noScans)
    await correct(students[1]?.id ?? '', noScans, 'LV')
    const result = await summary(noScans)
    expect(result.state).toBe('not_computed')
    expect(countsOf(result, classId)).toEqual({
      students: 3,
      onTime: 0,
      late: 0,
      leftEarly: 0,
      incomplete: 0,
      onLeave: 1,
      absent: null,
      notScannedYet: null,
    })
  })

  it('names a holiday and counts nobody absent or waiting to scan on it', async () => {
    const holiday = '2026-10-21'
    await server.db.holiday.create({ data: { dayDate: new Date(`${holiday}T00:00:00.000Z`), name: 'Dashain' } })
    const { classId } = await classWith('Class 3', ['H', undefined, 'P'], holiday)
    const result = await summary(holiday)
    expect(result.holidayName).toBe('Dashain')
    expect(countsOf(result, classId)).toMatchObject({ students: 3, onTime: 1, absent: 0, notScannedYet: 0 })
  })

  it('counts active students only, gives counts and no names, and says when scans were last pulled', async () => {
    const { classId, students } = await classWith('Class 4', ['P', 'P'], TODAY)
    await server.db.student.update({ where: { id: students[1]?.id ?? '' }, data: { status: 'inactive' } })
    const pulledAt = new Date('2026-10-31T04:55:00.000Z')
    await server.db.device.create({
      data: { name: 'Main gate device', connection: 'lan', host: '192.168.1.201', port: 4370, lastSyncAt: pulledAt, lastSuccessAt: pulledAt },
    })

    const result = await summary(TODAY)
    expect(countsOf(result, classId)).toMatchObject({ students: 1, onTime: 1 })
    expect(result.lastScansPulledAt).toBe(pulledAt.toISOString())
    expect(Object.keys(result.classes[0] ?? {}).sort()).toEqual(
      ['absent', 'classId', 'className', 'incomplete', 'late', 'leftEarly', 'notScannedYet', 'onLeave', 'onTime', 'students'].sort(),
    )
  })

  it('closes the day at the time in the attendance rules', async () => {
    await server.db.attendanceRule.create({
      data: {
        appliesTo: 'student',
        startTime: '09:45',
        graceMinutes: 10,
        lastCheckinTime: '11:00',
        earlyLeaveBefore: '15:30',
        dayCloseTime: '15:30',
        requireCheckout: false,
        duplicateWindowMinutes: 2,
      },
    })
    const { classId } = await classWith('Class 5', ['A', undefined], TODAY)
    expect(await summary(TODAY)).toMatchObject({ dayClosesAt: '15:30', state: 'open' })

    await at('15:29')
    expect(countsOf(await summary(TODAY), classId)).toMatchObject({ absent: 0, notScannedYet: 2 })
    await at('15:30')
    const closed = await summary(TODAY)
    expect(closed.state).toBe('closed')
    expect(countsOf(closed, classId)).toMatchObject({ absent: 1, notScannedYet: 1 })
  })
})

describe('who can see it', () => {
  it('refuses a role without attendance.view', async () => {
    const role = await server.db.role.findUniqueOrThrow({ where: { name: 'accountant' } })
    await server.db.rolePermission.deleteMany({ where: { roleId: role.id, permissionKey: 'attendance.view' } })
    accountantToken = await signIn(server, accountant, COUNTER)
    const response = await server.call({ method: 'GET', path: `/attendance/summary?date=${TODAY}`, token: accountantToken, ip: COUNTER })
    expect(errorOf(response)).toMatchObject({ status: 403, code: 'NO_PERMISSION' })
  })
})
