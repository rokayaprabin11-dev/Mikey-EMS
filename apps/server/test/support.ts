import { randomUUID } from 'node:crypto'
import type { NetworkInterfaceInfo } from 'node:os'

import { createDb, type PrismaClient, type Student, type User } from '@mikey/db'
import { API_PREFIX, bsMonthName, bsToAd, errorBodySchema, loginResponseSchema } from '@mikey/shared'
import { hash } from '@node-rs/argon2'
import type { FastifyInstance, LightMyRequestResponse } from 'fastify'
import { inject } from 'vitest'

import { buildApp } from '../src/app.ts'

const COMPUTER_1 = '127.0.0.1'
export const PASSWORD = 'correct-horse-2083'
export const SERVER_NAME = 'MIKEY-SERVER'

// Computer 1 on the office network 192.168.1.0/24.
const interfaces: NetworkInterfaceInfo[] = [
  { address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal: true, cidr: '127.0.0.1/8' },
  {
    address: '192.168.1.10',
    netmask: '255.255.255.0',
    family: 'IPv4',
    mac: 'aa:bb:cc:dd:ee:01',
    internal: false,
    cidr: '192.168.1.10/24',
  },
]

export interface Call {
  method: 'GET' | 'POST'
  path: string
  ip?: string
  token?: string
  headers?: Record<string, string>
  body?: object
}

export interface TestServer {
  db: PrismaClient
  now: () => Date
  advanceMinutes: (minutes: number) => void
  call: (request: Call) => Promise<LightMyRequestResponse>
  close: () => Promise<void>
}

export function startTestServer(databaseUrl = inject('testDatabaseUrl')): TestServer {
  const db = createDb(databaseUrl)
  let now = new Date('2026-10-31T04:15:00.000Z')
  const app: FastifyInstance = buildApp(
    { db, clock: () => now, hostname: () => SERVER_NAME, networkInterfaces: () => interfaces },
    { logger: false },
  )
  return {
    db,
    now: () => now,
    advanceMinutes: (minutes) => {
      now = new Date(now.getTime() + minutes * 60_000)
    },
    call: ({ method, path, ip = COMPUTER_1, token, headers = {}, body }) =>
      app.inject({
        method,
        url: API_PREFIX + path,
        remoteAddress: ip,
        headers: token === undefined ? headers : { ...headers, authorization: `Bearer ${token}` },
        ...(body === undefined ? {} : { payload: body }),
      }),
    close: async () => {
      await app.close()
      await db.$disconnect()
    },
  }
}

let passwordHash: Promise<string> | undefined

export async function createUser(db: PrismaClient, role: 'super_admin' | 'accountant'): Promise<User> {
  const { id: roleId } = await db.role.findUniqueOrThrow({ where: { name: role } })
  passwordHash ??= hash(PASSWORD)
  return db.user.create({
    data: {
      username: `${role}.${randomUUID().slice(0, 8)}`,
      passwordHash: await passwordHash,
      fullName: role === 'super_admin' ? 'Test Super Admin' : 'Test Accountant',
      roleId,
    },
  })
}

export async function allowComputer(db: PrismaClient, ip: string, allowedBy: User): Promise<void> {
  await db.allowedComputer.create({ data: { ip, computerName: 'ACCOUNTS-PC', allowedById: allowedBy.id } })
}

export async function signIn(server: TestServer, user: User, ip = COMPUTER_1): Promise<string> {
  const response = await server.call({
    method: 'POST',
    path: '/auth/login',
    ip,
    body: { username: user.username, password: PASSWORD },
  })
  if (response.statusCode !== 200) {
    throw new Error(`Signing in ${user.username} failed with ${response.statusCode}: ${response.body}`)
  }
  return loginResponseSchema.parse(response.json()).token
}

export function errorOf(response: LightMyRequestResponse): { status: number; code: string; message: string } {
  const { error } = errorBodySchema.parse(response.json())
  return { status: response.statusCode, code: error.code, message: error.message }
}

export const SCHOOL_PROFILE = {
  name: 'Mikey English Medium School',
  address: 'Banepa-7, Kavrepalanchok',
  phone: '011-000000',
  email: null,
  pan: '000000000',
}

export interface School {
  sessionId: string
  sectionId: string
  heads: { tuition: string; annual: string }
  cashId: string
  bankId: string
}

function dbDate(ad: string): Date {
  return new Date(`${ad}T00:00:00.000Z`)
}

// Class 7 A in session 2083, two fee heads, and one cash and one bank account. Safe to call from
// every test file.
export async function ensureSchool(db: PrismaClient): Promise<School> {
  const profile = { key: 'school.profile', value: SCHOOL_PROFILE }
  await db.setting.upsert({ where: { key: profile.key }, create: profile, update: { value: SCHOOL_PROFILE } })
  const session = await db.academicSession.upsert({
    where: { name: '2083' },
    create: { name: '2083', startDate: dbDate('2026-04-28'), isCurrent: true },
    update: {},
  })
  const schoolClass = await db.schoolClass.upsert({
    where: { name: 'Class 7' },
    create: { name: 'Class 7', sortOrder: 9 },
    update: {},
  })
  const section = await db.section.upsert({
    where: { classId_name: { classId: schoolClass.id, name: 'A' } },
    create: { classId: schoolClass.id, name: 'A', sortOrder: 1 },
    update: {},
  })
  const tuition = await db.feeHead.upsert({
    where: { name: 'Monthly tuition' },
    create: { name: 'Monthly tuition', kind: 'monthly' },
    update: {},
  })
  const annual = await db.feeHead.upsert({ where: { name: 'Annual' }, create: { name: 'Annual', kind: 'annual' }, update: {} })
  const cash = await db.account.upsert({
    where: { name: 'Cash in hand' },
    create: { name: 'Cash in hand', kind: 'cash' },
    update: {},
  })
  const bank = await db.account.upsert({
    where: { name: 'Current account' },
    create: { name: 'Current account', kind: 'bank' },
    update: {},
  })
  return {
    sessionId: session.id,
    sectionId: section.id,
    heads: { tuition: tuition.id, annual: annual.id },
    cashId: cash.id,
    bankId: bank.id,
  }
}

export async function createStudent(db: PrismaClient, school: School, fullName = 'Bibek Lama'): Promise<Student> {
  const { _max } = await db.studentEnrollment.aggregate({
    where: { sessionId: school.sessionId, sectionId: school.sectionId },
    _max: { rollNo: true },
  })
  return db.student.create({
    data: {
      studentCode: `TEST-${randomUUID().slice(0, 8)}`,
      fullName,
      gender: 'male',
      dobDate: dbDate('2014-05-01'),
      address: 'Banepa-7, Kavrepalanchok',
      admissionDate: dbDate('2026-04-28'),
      enrollments: {
        create: { sessionId: school.sessionId, sectionId: school.sectionId, rollNo: (_max.rollNo ?? 0) + 1 },
      },
      guardians: { create: { fullName: 'Pasang Lama', relationship: 'Father', phone: '98600 12884' } },
    },
  })
}

// A due billed on the 1st of a BS month of 2083 and due on the 15th.
export function addDue(
  db: PrismaClient,
  school: School,
  studentId: string,
  due: { month: number; rupees: number; head?: 'tuition' | 'annual'; discountRupees?: number },
) {
  const head = due.head ?? 'tuition'
  return db.feeDue.create({
    data: {
      studentId,
      sessionId: school.sessionId,
      feeHeadId: school.heads[head],
      periodLabel: head === 'tuition' ? `${bsMonthName(due.month)} 2083` : '2083',
      billDate: dbDate(bsToAd({ year: 2083, month: due.month, day: 1 })),
      dueDate: dbDate(bsToAd({ year: 2083, month: due.month, day: 15 })),
      amountPaisa: BigInt(due.rupees) * 100n,
      discountPaisa: BigInt(due.discountRupees ?? 0) * 100n,
    },
  })
}

export function addFine(db: PrismaClient, feeDueId: string, rupees: number, reason = 'Late fine, Ashwin 2083') {
  return db.fine.create({ data: { feeDueId, amountPaisa: BigInt(rupees) * 100n, reason } })
}
