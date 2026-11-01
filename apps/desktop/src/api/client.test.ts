import { describe, expect, it } from 'vitest'

import type { ServerReply, ServerRequest } from '../../electron/bridge.ts'
import { ApiError, createApiClient, ReplyNotUnderstoodError, UnreachableError } from './client.ts'

const encoder = new TextEncoder()

function reply(status: number, body: unknown, contentType = 'application/json; charset=utf-8'): ServerReply {
  const bytes = body instanceof Uint8Array ? body : encoder.encode(typeof body === 'string' ? body : JSON.stringify(body))
  return { reached: true, status, contentType, body: bytes }
}

// A Computer 1 that answers each request with the next reply, and remembers what it was sent.
function computer1(...replies: ServerReply[]) {
  const sent: ServerRequest[] = []
  const client = createApiClient((request) => {
    sent.push(request)
    const next = replies.shift()
    if (next === undefined) {
      throw new Error('More requests than replies.')
    }
    return Promise.resolve(next)
  })
  return { client, sent }
}

const HEALTH = {
  server: 'ok',
  db: 'ok',
  device: 'none',
  lastSyncAt: null,
  lastAttemptAt: null,
  cloudBackup: 'not_set_up',
  allowed: true,
  time: '2026-11-01T04:15:00.000Z',
  serverName: 'MIKEY-SERVER',
  schoolName: 'Mikey English Medium School',
}

const STUDENT_ID = '0b8f2a4e-3c1d-4e5f-8a9b-1c2d3e4f5a6b'

describe('the API client', () => {
  it('checks the reply against the contract and gives it back typed', async () => {
    const { client, sent } = computer1(reply(200, HEALTH))
    const health = await client.call('health')
    expect(health.db === 'ok' && health.serverName).toBe('MIKEY-SERVER')
    expect(sent).toEqual([{ method: 'GET', path: '/health', token: null, body: null, timeoutMs: 15_000 }])
  })

  it('fills in the path, writes the query and sends the token where a session is needed', async () => {
    const { client, sent } = computer1(reply(200, { students: [] }), reply(200, { classes: [] }))
    client.setToken('session-token')
    await client.call('searchStudents', { query: { q: 'sita', withDues: 'true', classId: undefined } }, { timeoutMs: 4_000 })
    await client.call('classes')
    expect(sent.map(({ method, path, token, timeoutMs }) => ({ method, path, token, timeoutMs }))).toEqual([
      { method: 'GET', path: '/students?q=sita&withDues=true', token: 'session-token', timeoutMs: 4_000 },
      { method: 'GET', path: '/classes', token: 'session-token', timeoutMs: 15_000 },
    ])
  })

  it('never sends the token to the routes open before sign-in', async () => {
    const { client, sent } = computer1(reply(200, HEALTH), reply(200, { ip: '192.168.1.11', status: 'pending', decidedAt: null }))
    client.setToken('session-token')
    await client.call('health')
    await client.call('requestConnection', { body: { computerName: 'ACCOUNTS-PC', askAgain: false } })
    expect(sent.map((request) => request.token)).toEqual([null, null])
    expect(sent[1]).toMatchObject({ method: 'POST', path: '/connection-requests', body: '{"computerName":"ACCOUNTS-PC","askAgain":false}' })
  })

  it('puts path parameters in safely', async () => {
    const { client, sent } = computer1(reply(200, { student: null }))
    await expect(client.call('studentFees', { params: { studentId: STUDENT_ID } })).rejects.toBeInstanceOf(ReplyNotUnderstoodError)
    expect(sent[0]?.path).toBe(`/students/${STUDENT_ID}/fees`)
  })

  it('refuses a request that does not match the contract, before sending it', async () => {
    const { client, sent } = computer1()
    await expect(client.call('requestConnection', { body: { computerName: '', askAgain: false } })).rejects.toThrow(
      'does not match the API contract',
    )
    await expect(client.call('studentFees', { params: { studentId: '../payments' } })).rejects.toThrow('does not match')
    expect(sent).toEqual([])
  })

  it("gives Computer 1's error with its code and its message for the user", async () => {
    const message = 'This account is switched off. Ask the Super Admin to switch it on.'
    const { client } = computer1(reply(403, { error: { code: 'ACCOUNT_INACTIVE', message, details: {} } }))
    const error = await client.call('login', { body: { username: 'bikash.acc', password: 'x' } }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ code: 'ACCOUNT_INACTIVE', status: 403, message, details: {} })
  })

  it('says when Computer 1 could not be reached, keeping the reason for the details', async () => {
    const { client } = computer1({ reached: false, reason: 'fetch failed: connect ECONNREFUSED 192.168.1.10:3100' })
    const error = await client.call('health').catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(UnreachableError)
    expect(error).toMatchObject({
      message: "Can't reach Computer 1. Check that it is on and connected to the office network.",
      reason: 'fetch failed: connect ECONNREFUSED 192.168.1.10:3100',
    })
  })

  it('says when a reply cannot be read: not the contract, not JSON, or an unknown error', async () => {
    const { client } = computer1(
      reply(200, { ...HEALTH, allowed: 'yes' }),
      reply(200, '<html>'),
      reply(500, { error: { code: 'SOMETHING_NEW', message: 'x', details: {} } }),
    )
    for (let i = 0; i < 3; i += 1) {
      const error = await client.call('health').catch((caught: unknown) => caught)
      expect(error).toBeInstanceOf(ReplyNotUnderstoodError)
      expect((error as Error).message).toBe(
        'Computer 1 sent a reply this app cannot read. Make sure both computers have the same version of Mikey EMS.',
      )
    }
  })

  it('gives a PDF as its bytes, and nothing for an empty reply', async () => {
    const pdf = encoder.encode('%PDF-1.3')
    const { client } = computer1(reply(200, pdf, 'application/pdf'), reply(200, HEALTH), reply(204, ''))
    client.setToken('session-token')
    expect(await client.call('testReceipt')).toEqual(pdf)
    await expect(client.call('testReceipt')).rejects.toBeInstanceOf(ReplyNotUnderstoodError)
    expect(await client.call('logout')).toBeUndefined()
  })
})
