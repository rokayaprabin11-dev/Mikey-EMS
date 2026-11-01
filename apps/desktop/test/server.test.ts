import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { ServerRequest } from '../electron/bridge.ts'
import { sendToServer, serverRequestSchema } from '../electron/main/server.ts'

interface Seen {
  method: string | undefined
  url: string | undefined
  authorization: string | undefined
  contentType: string | undefined
  body: string
}

let server: Server
let serverUrl: string
const seen: Seen[] = []

async function bodyOf(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

beforeAll(async () => {
  server = createServer((request, response) => {
    void bodyOf(request).then((body) => {
      seen.push({
        method: request.method,
        url: request.url,
        authorization: request.headers.authorization,
        contentType: request.headers['content-type'],
        body,
      })
      if (request.url === '/api/v1/slow') {
        setTimeout(() => response.end('{}'), 500)
        return
      }
      response.writeHead(201, { 'content-type': 'application/json' }).end('{"ok":true}')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  serverUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
})

const request: ServerRequest = { method: 'GET', path: '/health', token: null, body: null, timeoutMs: 2_000 }

describe('a request to Computer 1', () => {
  it('goes to the saved address under /api/v1, with the token and the JSON body', async () => {
    const reply = await sendToServer(serverUrl, {
      method: 'POST',
      path: '/payments?x=1',
      token: 'abc',
      body: '{"amount":100}',
      timeoutMs: 2_000,
    })
    expect(reply).toMatchObject({ reached: true, status: 201, contentType: 'application/json' })
    expect(reply.reached && new TextDecoder().decode(reply.body)).toBe('{"ok":true}')
    expect(seen.at(-1)).toEqual({
      method: 'POST',
      url: '/api/v1/payments?x=1',
      authorization: 'Bearer abc',
      contentType: 'application/json',
      body: '{"amount":100}',
    })
  })

  it('sends no token and no body when it has none', async () => {
    await sendToServer(serverUrl, request)
    expect(seen.at(-1)).toMatchObject({ method: 'GET', url: '/api/v1/health', authorization: undefined, body: '' })
  })

  it('says when no reply came: nothing listening, or too slow', async () => {
    const closed = createServer()
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve))
    const closedUrl = `http://127.0.0.1:${(closed.address() as AddressInfo).port}`
    await new Promise((resolve) => closed.close(resolve))

    const refused = await sendToServer(closedUrl, request)
    expect(refused.reached).toBe(false)
    expect(!refused.reached && refused.reason).toContain('ECONNREFUSED')
    expect(await sendToServer(serverUrl, { ...request, path: '/slow', timeoutMs: 50 })).toEqual({
      reached: false,
      reason: 'No reply in time',
    })
  })

  it('takes only paths under /api/v1 from the renderer', () => {
    for (const path of ['/health', '/students?q=sita&withDues=true', '/day-closes/2026-11-01/print']) {
      expect(serverRequestSchema.safeParse({ ...request, path }).success).toBe(true)
    }
    for (const path of ['health', '@evil.example/x', '/a#b', '/a b', 'http://evil.example/']) {
      expect(serverRequestSchema.safeParse({ ...request, path }).success, path).toBe(false)
    }
  })
})
