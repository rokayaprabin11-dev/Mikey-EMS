import { randomUUID } from 'node:crypto'
import type { NetworkInterfaceInfo } from 'node:os'

import { createDb, type PrismaClient, type User } from '@mikey/db'
import { API_PREFIX, errorBodySchema, loginResponseSchema } from '@mikey/shared'
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
