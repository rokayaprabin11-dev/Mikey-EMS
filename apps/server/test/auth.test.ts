import { createHash } from 'node:crypto'

import type { User } from '@mikey/db'
import { ACCOUNTANT_DEFAULT_PERMISSIONS, loginResponseSchema, sessionSchema } from '@mikey/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { allowComputer, createUser, errorOf, PASSWORD, signIn, startTestServer, type TestServer } from './support.ts'

const server: TestServer = startTestServer()
let admin: User

beforeAll(async () => {
  admin = await createUser(server.db, 'super_admin')
})

afterAll(() => server.close())

function login(user: User, password: string, ip?: string) {
  return server.call({ method: 'POST', path: '/auth/login', ip, body: { username: user.username, password } })
}

function sessionOf(token: string | undefined, ip?: string) {
  return server.call({ method: 'GET', path: '/auth/session', token, ip })
}

async function auditCounts(user: User): Promise<Record<string, number>> {
  const rows = await server.db.auditLog.groupBy({ by: ['action'], where: { userId: user.id }, _count: true })
  return Object.fromEntries(rows.map((row) => [row.action, row._count]))
}

describe('signing in', () => {
  it('signs in on Computer 1 and keeps only a hash of the token', async () => {
    const user = await createUser(server.db, 'accountant')
    const response = await login(user, PASSWORD)

    expect(response.statusCode).toBe(200)
    const body = loginResponseSchema.parse(response.json())
    expect(body.user).toMatchObject({ id: user.id, username: user.username, fullName: user.fullName, role: 'accountant' })
    expect(body.user.permissions.toSorted()).toEqual(ACCOUNTANT_DEFAULT_PERMISSIONS.toSorted())
    expect(body.idleTimeoutMinutes).toBe(15)

    const sessions = await server.db.session.findMany({ where: { userId: user.id } })
    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({
      tokenHash: createHash('sha256').update(body.token).digest('hex'),
      computer: 1,
      lastSeenAt: server.now(),
      expiresAt: new Date(server.now().getTime() + 12 * 60 * 60_000),
    })
    expect(await server.db.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({
      lastLoginAt: server.now(),
    })
    expect(await auditCounts(user)).toEqual({ 'auth.signed_in': 1 })
  })

  it('treats the username as case-insensitive and ignores spaces around it', async () => {
    const user = await createUser(server.db, 'accountant')
    expect((await login({ ...user, username: `  ${user.username.toUpperCase()} ` }, PASSWORD)).statusCode).toBe(200)
  })

  it('gives the same answer for an unknown username and a wrong password', async () => {
    const user = await createUser(server.db, 'accountant')
    const unknown = errorOf(await login({ ...user, username: 'nobody.here' }, PASSWORD))
    const wrong = errorOf(await login(user, 'not-the-password'))

    expect(unknown).toEqual({ status: 401, code: 'WRONG_USERNAME_OR_PASSWORD', message: wrong.message })
    expect(wrong.code).toBe('WRONG_USERNAME_OR_PASSWORD')
    expect(await auditCounts(user)).toEqual({ 'auth.sign_in_failed': 1 })
  })

  it('records an unknown username with the computer and its address, never the typed text', async () => {
    await allowComputer(server.db, '192.168.1.62', admin)
    const typed = { ...admin, username: 'Secret-Pass-2083' }
    expect(errorOf(await login(typed, PASSWORD, '192.168.1.62')).code).toBe('WRONG_USERNAME_OR_PASSWORD')

    const rows = await server.db.auditLog.findMany({
      where: { summary: 'Sign-in with unknown username on Computer 2 (192.168.1.62)' },
    })
    expect(rows).toMatchObject([{ userId: null, action: 'auth.sign_in_failed', computer: 2, before: null, after: null }])
    expect(
      await server.db.auditLog.count({ where: { summary: { contains: 'secret-pass', mode: 'insensitive' } } }),
    ).toBe(0)
  })

  it('refuses a computer that is not allowed, and records Computer 2 once it is', async () => {
    const user = await createUser(server.db, 'accountant')
    expect(errorOf(await login(user, PASSWORD, '192.168.1.60'))).toMatchObject({ status: 403, code: 'NOT_ALLOWED' })

    await allowComputer(server.db, '192.168.1.60', admin)
    expect((await login(user, PASSWORD, '192.168.1.60')).statusCode).toBe(200)
    expect(await server.db.session.findFirst({ where: { userId: user.id } })).toMatchObject({ computer: 2 })
  })

  it('locks the username for 10 minutes after five wrong passwords in 10 minutes', async () => {
    const user = await createUser(server.db, 'accountant')
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      expect(errorOf(await login(user, 'not-the-password')).code).toBe('WRONG_USERNAME_OR_PASSWORD')
    }
    expect(errorOf(await login(user, 'not-the-password'))).toEqual({
      status: 403,
      code: 'ACCOUNT_LOCKED',
      message: 'Too many wrong passwords. Try again in 10 minutes.',
    })
    expect(await server.db.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({
      lockedUntil: new Date(server.now().getTime() + 10 * 60_000),
    })

    expect(errorOf(await login(user, PASSWORD)).code).toBe('ACCOUNT_LOCKED')
    server.advanceMinutes(9.5)
    expect(errorOf(await login(user, PASSWORD)).message).toBe('Too many wrong passwords. Try again in 1 minute.')
    server.advanceMinutes(0.5)
    expect((await login(user, PASSWORD)).statusCode).toBe(200)

    expect(await server.db.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({ lockedUntil: null })
    expect(await auditCounts(user)).toEqual({
      'auth.sign_in_failed': 5,
      'auth.locked': 1,
      'auth.sign_in_refused': 2,
      'auth.signed_in': 1,
    })
  })

  it('does not count wrong passwords from more than 10 minutes ago', async () => {
    const user = await createUser(server.db, 'accountant')
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await login(user, 'not-the-password')
    }
    server.advanceMinutes(10)
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      expect(errorOf(await login(user, 'not-the-password')).code).toBe('WRONG_USERNAME_OR_PASSWORD')
    }
    expect(errorOf(await login(user, 'not-the-password')).code).toBe('ACCOUNT_LOCKED')
  })

  it('starts counting again after a successful sign-in', async () => {
    const user = await createUser(server.db, 'accountant')
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await login(user, 'not-the-password')
    }
    expect((await login(user, PASSWORD)).statusCode).toBe(200)
    server.advanceMinutes(1)
    expect(errorOf(await login(user, 'not-the-password')).code).toBe('WRONG_USERNAME_OR_PASSWORD')
  })

  it('counts wrong passwords sent all at once one by one, so only four get a second try', async () => {
    const user = await createUser(server.db, 'accountant')
    const attempts = Array.from({ length: 10 }, () => login(user, 'not-the-password'))
    const codes = (await Promise.all(attempts)).map((response) => errorOf(response).code)

    expect(codes.filter((code) => code === 'WRONG_USERNAME_OR_PASSWORD')).toHaveLength(4)
    expect(codes.filter((code) => code === 'ACCOUNT_LOCKED')).toHaveLength(6)
    expect(await auditCounts(user)).toEqual({
      'auth.sign_in_failed': 5,
      'auth.locked': 1,
      'auth.sign_in_refused': 5,
    })
  })

  it('refuses a switched-off account, and does not say so to a wrong password', async () => {
    const user = await createUser(server.db, 'accountant')
    await server.db.user.update({ where: { id: user.id }, data: { status: 'inactive' } })

    expect(errorOf(await login(user, PASSWORD))).toMatchObject({ status: 403, code: 'ACCOUNT_INACTIVE' })
    expect(errorOf(await login(user, 'not-the-password')).code).toBe('WRONG_USERNAME_OR_PASSWORD')
    expect(await server.db.session.count({ where: { userId: user.id } })).toBe(0)
  })

  it('checks what was sent', async () => {
    const response = await server.call({ method: 'POST', path: '/auth/login', body: { username: '' } })
    expect(errorOf(response)).toMatchObject({ status: 400, code: 'VALIDATION_FAILED' })
  })
})

describe('sessions', () => {
  it('needs a token that Computer 1 issued', async () => {
    expect(errorOf(await sessionOf(undefined))).toMatchObject({ status: 401, code: 'NOT_SIGNED_IN' })
    expect(errorOf(await sessionOf('made-up-token'))).toMatchObject({ status: 401, code: 'NOT_SIGNED_IN' })
  })

  it('returns the signed-in user', async () => {
    const user = await createUser(server.db, 'accountant')
    const response = await sessionOf(await signIn(server, user))

    expect(response.statusCode).toBe(200)
    expect(sessionSchema.parse(response.json())).toMatchObject({
      user: { id: user.id, role: 'accountant' },
      idleTimeoutMinutes: 15,
    })
  })

  it('signs out after 15 minutes without use, and each request starts the 15 minutes again', async () => {
    const user = await createUser(server.db, 'accountant')
    const token = await signIn(server, user)

    server.advanceMinutes(14)
    expect((await sessionOf(token)).statusCode).toBe(200)
    server.advanceMinutes(14)
    expect((await sessionOf(token)).statusCode).toBe(200)
    server.advanceMinutes(15)
    expect(errorOf(await sessionOf(token))).toEqual({
      status: 401,
      code: 'SESSION_EXPIRED',
      message: 'You were signed out because the app was not used for 15 minutes. Sign in again.',
    })

    expect(await server.db.session.count({ where: { userId: user.id } })).toBe(0)
    expect(errorOf(await sessionOf(token)).code).toBe('NOT_SIGNED_IN')
    expect(await auditCounts(user)).toEqual({ 'auth.signed_in': 1, 'auth.session_ended': 1 })
  })

  it('signs out after 12 hours however busy the day is', async () => {
    const user = await createUser(server.db, 'accountant')
    const token = await signIn(server, user)

    for (let elapsed = 10; elapsed < 12 * 60; elapsed += 10) {
      server.advanceMinutes(10)
      expect((await sessionOf(token)).statusCode).toBe(200)
    }
    server.advanceMinutes(10)
    expect(errorOf(await sessionOf(token))).toEqual({
      status: 401,
      code: 'SESSION_EXPIRED',
      message: 'You were signed out because you were signed in for 12 hours. Sign in again.',
    })
  })

  it('ends the session of an account that is switched off', async () => {
    const user = await createUser(server.db, 'accountant')
    const token = await signIn(server, user)
    await server.db.user.update({ where: { id: user.id }, data: { status: 'inactive' } })

    expect(errorOf(await sessionOf(token)).code).toBe('NOT_SIGNED_IN')
    expect(await server.db.session.count({ where: { userId: user.id } })).toBe(0)
  })

  it('signs out', async () => {
    const user = await createUser(server.db, 'accountant')
    const token = await signIn(server, user)

    expect((await server.call({ method: 'POST', path: '/auth/logout', token })).statusCode).toBe(204)
    expect(errorOf(await sessionOf(token)).code).toBe('NOT_SIGNED_IN')
    expect(await auditCounts(user)).toEqual({ 'auth.signed_in': 1, 'auth.signed_out': 1 })
  })

  it('refuses a session from a computer that has been removed from the allow list', async () => {
    const user = await createUser(server.db, 'accountant')
    await allowComputer(server.db, '192.168.1.61', admin)
    const token = await signIn(server, user, '192.168.1.61')
    await server.db.allowedComputer.update({
      where: { ip: '192.168.1.61' },
      data: { removedAt: server.now(), removedById: admin.id },
    })

    expect(errorOf(await sessionOf(token, '192.168.1.61'))).toMatchObject({ status: 403, code: 'NOT_ALLOWED' })
  })
})
