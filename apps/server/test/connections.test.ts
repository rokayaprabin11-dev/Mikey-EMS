import type { User } from '@mikey/db'
import { allowedComputerSchema, connectionsResponseSchema } from '@mikey/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { allowComputer, createUser, errorOf, signIn, startTestServer, type TestServer } from './support.ts'

const server: TestServer = startTestServer()
let admin: User
let accountant: User

beforeAll(async () => {
  admin = await createUser(server.db, 'super_admin')
  accountant = await createUser(server.db, 'accountant')
})

afterAll(() => server.close())

function ask(ip: string, body: { computerName?: string; askAgain?: boolean } = {}) {
  return server.call({
    method: 'POST',
    path: '/connection-requests',
    ip,
    body: { computerName: 'ACCOUNTS-PC', ...body },
  })
}

async function statusOf(ip: string, body?: { computerName?: string; askAgain?: boolean }): Promise<unknown> {
  const response = await ask(ip, body)
  expect(response.statusCode).toBe(200)
  return response.json()
}

async function adminCall(method: 'GET' | 'POST', path: string, body?: object) {
  return server.call({ method, path, token: await signIn(server, admin), body })
}

async function pendingRequestId(ip: string): Promise<string> {
  const request = await server.db.connectionRequest.findFirstOrThrow({ where: { ip, status: 'pending' } })
  return request.id
}

describe('asking to connect', () => {
  it('records a request from the office network, and a repeat refreshes it at most once a minute', async () => {
    expect(await statusOf('192.168.1.21')).toEqual({ ip: '192.168.1.21', status: 'pending', decidedAt: null })
    const asked = server.now()

    server.advanceMinutes(0.5)
    expect(await statusOf('192.168.1.21')).toEqual({ ip: '192.168.1.21', status: 'pending', decidedAt: null })
    expect(await server.db.connectionRequest.findMany({ where: { ip: '192.168.1.21' } })).toMatchObject([
      { lastSeenAt: asked },
    ])

    server.advanceMinutes(0.5)
    expect(await statusOf('192.168.1.21', { computerName: 'ACCOUNTS-PC-2' })).toMatchObject({ status: 'pending' })
    expect(await server.db.connectionRequest.findMany({ where: { ip: '192.168.1.21' } })).toMatchObject([
      { requestedAt: asked, lastSeenAt: server.now(), computerName: 'ACCOUNTS-PC-2' },
    ])
  })

  it('reads an IPv4 address written inside IPv6 as IPv4', async () => {
    expect(await statusOf('::ffff:192.168.1.22')).toEqual({ ip: '192.168.1.22', status: 'pending', decidedAt: null })
  })

  it('refuses a computer outside the office network', async () => {
    expect(errorOf(await ask('10.0.0.5'))).toMatchObject({ status: 403, code: 'NOT_ON_LOCAL_NETWORK' })
  })

  it('checks what was sent', async () => {
    expect(errorOf(await ask('192.168.1.29', { computerName: ' ' }))).toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
    })
  })

  it('lets only the Super Admin see the requests', async () => {
    expect(errorOf(await server.call({ method: 'GET', path: '/connection-requests' }))).toMatchObject({
      status: 401,
      code: 'NOT_SIGNED_IN',
    })

    await allowComputer(server.db, '192.168.1.40', admin)
    const accountantToken = await signIn(server, accountant, '192.168.1.40')
    const refused = await server.call({
      method: 'GET',
      path: '/connection-requests',
      ip: '192.168.1.40',
      token: accountantToken,
    })
    expect(errorOf(refused)).toMatchObject({ status: 403, code: 'NO_PERMISSION' })

    const response = await adminCall('GET', '/connection-requests')
    expect(response.statusCode).toBe(200)
    const { pending, allowed } = connectionsResponseSchema.parse(response.json())
    expect(pending.map((request) => request.ip)).toEqual(['192.168.1.21', '192.168.1.22'])
    expect(allowed).toContainEqual(expect.objectContaining({ ip: '192.168.1.40', allowedBy: admin.fullName }))
  })

  it('allowing a request puts the computer on the allow list', async () => {
    await ask('192.168.1.23', { computerName: 'FRONT-DESK' })
    const requestId = await pendingRequestId('192.168.1.23')

    const response = await adminCall('POST', `/connection-requests/${requestId}/allow`)
    expect(response.statusCode).toBe(200)
    const allowed = allowedComputerSchema.parse(response.json())
    expect(allowed).toMatchObject({ ip: '192.168.1.23', computerName: 'FRONT-DESK', allowedBy: admin.fullName })

    expect(await server.db.connectionRequest.findUniqueOrThrow({ where: { id: requestId } })).toMatchObject({
      status: 'allowed',
      decidedById: admin.id,
      decidedAt: server.now(),
    })
    expect(await server.db.auditLog.findFirst({ where: { recordId: allowed.id } })).toMatchObject({
      action: 'network.computer_allowed',
      userId: admin.id,
      computer: 1,
    })
    // It learns when it was allowed, but not who allowed it: it has not signed in.
    expect(await statusOf('192.168.1.23')).toEqual({ ip: '192.168.1.23', status: 'allowed', decidedAt: allowed.allowedAt })

    expect(errorOf(await adminCall('POST', `/connection-requests/${requestId}/allow`))).toMatchObject({
      status: 409,
      code: 'REQUEST_NOT_PENDING',
    })
    expect(errorOf(await adminCall('POST', `/connection-requests/${crypto.randomUUID()}/allow`))).toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    })
  })

  it('a declined computer stays declined until it asks again, at most once a minute', async () => {
    await ask('192.168.1.24')
    const requestId = await pendingRequestId('192.168.1.24')

    expect((await adminCall('POST', `/connection-requests/${requestId}/decline`)).statusCode).toBe(204)
    const declinedAt = server.now().toISOString()
    expect(await server.db.auditLog.findFirst({ where: { recordId: requestId } })).toMatchObject({
      action: 'network.request_declined',
    })
    expect(await statusOf('192.168.1.24')).toEqual({ ip: '192.168.1.24', status: 'declined', decidedAt: declinedAt })
    expect(await statusOf('192.168.1.24', { askAgain: true })).toMatchObject({ status: 'declined' })

    server.advanceMinutes(1)
    expect(await statusOf('192.168.1.24')).toMatchObject({ status: 'declined' })
    expect(await statusOf('192.168.1.24', { askAgain: true })).toMatchObject({ status: 'pending' })
    expect(await server.db.connectionRequest.count({ where: { ip: '192.168.1.24' } })).toBe(2)

    expect(errorOf(await adminCall('POST', `/connection-requests/${requestId}/decline`))).toMatchObject({
      status: 409,
      code: 'REQUEST_NOT_PENDING',
    })
  })

  it('a request expires 24 hours after its last repeat', async () => {
    await ask('192.168.1.25')
    const requestId = await pendingRequestId('192.168.1.25')

    server.advanceMinutes(24 * 60)
    const stillListed = connectionsResponseSchema.parse((await adminCall('GET', '/connection-requests')).json())
    expect(stillListed.pending.map((request) => request.id)).toContain(requestId)

    server.advanceMinutes(1)
    const listed = connectionsResponseSchema.parse((await adminCall('GET', '/connection-requests')).json())
    expect(listed.pending.map((request) => request.id)).not.toContain(requestId)
    expect(errorOf(await adminCall('POST', `/connection-requests/${requestId}/allow`)).code).toBe('REQUEST_NOT_PENDING')

    expect(await statusOf('192.168.1.25')).toMatchObject({ status: 'pending' })
    expect(await server.db.connectionRequest.findUniqueOrThrow({ where: { id: requestId } })).toMatchObject({
      status: 'expired',
    })
    expect(await pendingRequestId('192.168.1.25')).not.toBe(requestId)
  })

  it('keeps one request per computer when repeats arrive at once', async () => {
    const answers = await Promise.all(Array.from({ length: 5 }, () => ask('192.168.1.28')))
    expect(answers.map((response) => response.statusCode)).toEqual([200, 200, 200, 200, 200])
    expect(await server.db.connectionRequest.count({ where: { ip: '192.168.1.28' } })).toBe(1)
  })

  it('holds at most ten pending requests, even when they arrive at once', async () => {
    const waiting = await server.db.connectionRequest.count({ where: { status: 'pending' } })
    expect(waiting).toBeLessThan(8)
    for (let index = waiting; index < 8; index += 1) {
      expect(await statusOf(`192.168.1.${100 + index}`)).toMatchObject({ status: 'pending' })
    }

    const atOnce = await Promise.all([150, 151, 152, 153].map((host) => ask(`192.168.1.${host}`)))
    expect(atOnce.map((response) => response.statusCode).toSorted()).toEqual([200, 200, 422, 422])
    expect(await server.db.connectionRequest.count({ where: { status: 'pending' } })).toBe(10)
    expect(errorOf(await ask('192.168.1.160'))).toMatchObject({ status: 422, code: 'CONNECTION_REQUESTS_FULL' })
    expect(await statusOf(`192.168.1.${100 + waiting}`)).toMatchObject({ status: 'pending' })

    await server.db.connectionRequest.updateMany({ where: { status: 'pending' }, data: { status: 'declined' } })
  })
})

describe('the allow list', () => {
  it('adds a computer by IP address and answers its waiting request', async () => {
    expect(errorOf(await adminCall('POST', '/allowed-computers', { ip: '127.0.0.1', computerName: 'SELF' }))).toMatchObject({
      status: 422,
      code: 'ALWAYS_ALLOWED',
    })
    expect(errorOf(await adminCall('POST', '/allowed-computers', { ip: 'abc', computerName: 'X' }))).toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
    })

    await ask('192.168.1.26')
    const requestId = await pendingRequestId('192.168.1.26')
    const response = await adminCall('POST', '/allowed-computers', { ip: '192.168.1.26', computerName: 'ACCOUNTS-PC' })
    expect(response.statusCode).toBe(200)
    const allowed = allowedComputerSchema.parse(response.json())

    expect(await server.db.connectionRequest.findUniqueOrThrow({ where: { id: requestId } })).toMatchObject({
      status: 'allowed',
      decidedById: admin.id,
    })
    expect(await server.db.auditLog.findFirst({ where: { recordId: allowed.id } })).toMatchObject({
      action: 'network.computer_allowed',
    })
    expect(errorOf(await adminCall('POST', '/allowed-computers', { ip: '192.168.1.26', computerName: 'X' }))).toMatchObject({
      status: 409,
      code: 'ALREADY_ALLOWED',
    })
  })

  it('removing a computer refuses it from then on, and it can be allowed again', async () => {
    const added = allowedComputerSchema.parse(
      (await adminCall('POST', '/allowed-computers', { ip: '192.168.1.27', computerName: 'ACCOUNTS-PC' })).json(),
    )
    const accountantToken = await signIn(server, accountant, '192.168.1.27')

    expect((await adminCall('POST', `/allowed-computers/${added.id}/remove`)).statusCode).toBe(204)
    expect(await server.db.auditLog.findFirst({ where: { recordId: added.id, action: 'network.computer_removed' } })).not.toBeNull()
    const refused = await server.call({ method: 'GET', path: '/auth/session', ip: '192.168.1.27', token: accountantToken })
    expect(errorOf(refused)).toMatchObject({ status: 403, code: 'NOT_ALLOWED' })

    expect(errorOf(await adminCall('POST', `/allowed-computers/${added.id}/remove`))).toMatchObject({
      status: 409,
      code: 'ALREADY_REMOVED',
    })
    expect(errorOf(await adminCall('POST', `/allowed-computers/${crypto.randomUUID()}/remove`))).toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    })

    const again = await adminCall('POST', '/allowed-computers', { ip: '192.168.1.27', computerName: 'ACCOUNTS-PC' })
    const allowedAgain = allowedComputerSchema.parse(again.json())
    expect(allowedAgain).toMatchObject({ id: added.id, ip: '192.168.1.27' })
    expect(await statusOf('192.168.1.27')).toEqual({ ip: '192.168.1.27', status: 'allowed', decidedAt: allowedAgain.allowedAt })
  })
})
