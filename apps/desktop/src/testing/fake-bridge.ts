import { errorMessage } from '@mikey/shared'
import { type Mock, vi } from 'vitest'

import type { Bridge, Printer, ReceiptPrinter, ServerReply, ServerRequest, StartAt } from '../../electron/bridge.ts'

// A stand-in for the preload's bridge in screen tests: settings kept in memory, and a Computer 1
// that answers each request from `answer`.
export interface FakeBridge extends Bridge {
  sent: ServerRequest[]
  tested: string[]
  saved: { serverUrl: string | null; printer: ReceiptPrinter | null }
  finishStartup: Mock<(startAt: StartAt) => Promise<void>>
}

export function json(status: number, body: unknown): ServerReply {
  return {
    reached: true,
    status,
    contentType: 'application/json; charset=utf-8',
    body: new TextEncoder().encode(JSON.stringify(body)),
  }
}

export const NO_REPLY: ServerReply = { reached: false, reason: 'fetch failed: connect ECONNREFUSED 192.168.1.10:3100' }

export function health(overrides: Record<string, unknown> = {}): ServerReply {
  return json(200, {
    server: 'ok',
    db: 'ok',
    device: 'none',
    lastSyncAt: null,
    lastAttemptAt: null,
    cloudBackup: 'not_set_up',
    allowed: true,
    time: '2026-11-01T04:19:00.000Z',
    serverName: 'MIKEY-SERVER',
    schoolName: 'Mikey English Medium School',
    ...overrides,
  })
}

export function fakeBridge(options: {
  serverUrl?: string | null
  printers?: Printer[]
  answer?: (request: ServerRequest) => ServerReply
  testAnswer?: (serverUrl: string) => ServerReply
}): FakeBridge {
  const bridge: FakeBridge = {
    sent: [],
    tested: [],
    saved: { serverUrl: options.serverUrl ?? null, printer: null },
    appVersion: () => Promise.resolve('0.1.0'),
    computerName: () => Promise.resolve('ACCOUNTS-PC'),
    getServerUrl: () => Promise.resolve(bridge.saved.serverUrl),
    setServerUrl: (serverUrl) => {
      bridge.saved.serverUrl = serverUrl
      return Promise.resolve()
    },
    request: (request) => {
      bridge.sent.push(request)
      const answer = options.answer ?? (() => NO_REPLY)
      return Promise.resolve(answer(request))
    },
    testServer: (serverUrl) => {
      bridge.tested.push(serverUrl)
      const answer = options.testAnswer ?? (() => NO_REPLY)
      return Promise.resolve(answer(serverUrl))
    },
    listPrinters: () => Promise.resolve(options.printers ?? []),
    getPrinter: () => Promise.resolve(bridge.saved.printer),
    setPrinter: (printer) => {
      bridge.saved.printer = printer
      return Promise.resolve()
    },
    printPdf: () => Promise.reject(new Error('Not used in these tests.')),
    savePdfOrExcel: () => Promise.reject(new Error('Not used in these tests.')),
    finishStartup: vi.fn<(startAt: StartAt) => Promise<void>>(() => Promise.resolve()),
  }
  window.mikey = bridge
  return bridge
}

export const TOKEN = 'session-token-1'
export const PASSWORD = 'mikey-dev-2083'
export const BIKASH = {
  id: '6f3c2a10-4b7e-4d3a-9c51-2e8b7a9d0c41',
  username: 'bikash.acc',
  fullName: 'Bikash Thapa',
  role: 'accountant',
  permissions: [],
}

function failure(status: number, code: string, message: string): ServerReply {
  return json(status, { error: { code, message, details: {} } })
}

// A Computer 1 that signs bikash.acc in and keeps the session until `ended` or `reachable` says
// otherwise. Its clock reads `time`.
export function computer1WithSignIn(time = '2026-10-29T04:19:00.000Z') {
  const state = { ended: false, reachable: true, wrongPasswordMessage: errorMessage('WRONG_USERNAME_OR_PASSWORD') }
  const answer = (request: ServerRequest): ServerReply => {
    if (!state.reachable) {
      return NO_REPLY
    }
    const route = `${request.method} ${request.path}`
    if (route === 'GET /health') {
      return health({ time })
    }
    if (route === 'POST /auth/login') {
      const body = JSON.parse(request.body ?? '{}') as { username: string; password: string }
      return body.username === BIKASH.username && body.password === PASSWORD
        ? json(200, { token: TOKEN, user: BIKASH, idleTimeoutMinutes: 15 })
        : failure(401, 'WRONG_USERNAME_OR_PASSWORD', state.wrongPasswordMessage)
    }
    if (request.token !== TOKEN) {
      return failure(401, 'NOT_SIGNED_IN', errorMessage('NOT_SIGNED_IN'))
    }
    if (state.ended) {
      return failure(401, 'SESSION_EXPIRED', errorMessage('SESSION_EXPIRED', { idleMinutes: 15 }))
    }
    if (route === 'GET /auth/session') {
      return json(200, { user: BIKASH, idleTimeoutMinutes: 15 })
    }
    if (route === 'POST /auth/logout') {
      state.ended = true
      return { reached: true, status: 204, contentType: '', body: new Uint8Array() }
    }
    throw new Error(`Not expected: ${route}`)
  }
  return { answer, state }
}
