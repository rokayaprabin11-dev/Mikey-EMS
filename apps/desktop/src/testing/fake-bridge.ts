import { errorMessage } from '@mikey/shared'
import { type Mock, vi } from 'vitest'

import type {
  Bridge,
  CloseWarning,
  Printer,
  PrintResult,
  ReceiptPrinter,
  ServerReply,
  ServerRequest,
  StartAt,
} from '../../electron/bridge.ts'

// A stand-in for the preload's bridge in screen tests: settings kept in memory, and a Computer 1
// that answers each request from `answer`.
export interface FakeBridge extends Bridge {
  sent: ServerRequest[]
  tested: string[]
  saved: { serverUrl: string | null; printer: ReceiptPrinter | null }
  finishStartup: Mock<(startAt: StartAt) => Promise<void>>
  printPdf: Mock<(bytes: Uint8Array, printer: ReceiptPrinter | null) => Promise<PrintResult>>
  setCloseWarning: Mock<(warning: CloseWarning | null) => Promise<void>>
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
    printPdf: vi.fn<(bytes: Uint8Array, printer: ReceiptPrinter | null) => Promise<PrintResult>>(() =>
      Promise.resolve({ printed: true }),
    ),
    savePdfOrExcel: () => Promise.reject(new Error('Not used in these tests.')),
    finishStartup: vi.fn<(startAt: StartAt) => Promise<void>>(() => Promise.resolve()),
    setCloseWarning: vi.fn<(warning: CloseWarning | null) => Promise<void>>(() => Promise.resolve()),
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
// otherwise; `databaseDown` makes /health say its database has stopped. Its clock reads `time`.
// `more` answers signed-in routes before the frame's own.
export function computer1WithSignIn(time = '2026-10-29T04:19:00.000Z', more: (request: ServerRequest) => ServerReply | null = () => null) {
  const state = {
    ended: false,
    reachable: true,
    databaseDown: false,
    wrongPasswordMessage: errorMessage('WRONG_USERNAME_OR_PASSWORD'),
  }
  const answer = (request: ServerRequest): ServerReply => {
    if (!state.reachable) {
      return NO_REPLY
    }
    const route = `${request.method} ${request.path}`
    if (route === 'GET /health') {
      return state.databaseDown ? json(200, { server: 'ok', db: 'down', time, serverName: 'MIKEY-SERVER' }) : health({ time })
    }
    if (route === 'POST /auth/login') {
      const body = JSON.parse(request.body ?? '{}') as { username: string; password: string }
      if (body.username !== BIKASH.username || body.password !== PASSWORD) {
        return failure(401, 'WRONG_USERNAME_OR_PASSWORD', state.wrongPasswordMessage)
      }
      // Signing in again starts a new session.
      state.ended = false
      return json(200, { token: TOKEN, user: BIKASH, idleTimeoutMinutes: 15 })
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
    const answered = more(request) ?? frameRoutes(request)
    if (answered !== null) {
      return answered
    }
    throw new Error(`Not expected: ${route}`)
  }
  return { answer, state }
}

const student = (id: string, fullName: string, className: string, sectionName: string) => ({ id, fullName, className, sectionName })

// The Accountant's dashboard on 12 Kartik 2083 (29 Oct 2026), with the figures of the design.
export const FINANCE_DASHBOARD = {
  date: '2026-10-29',
  voidsToday: { amount: 120_000, receiptCount: 1 },
  collectedThisMonth: { amount: 68_425_000, bsMonth: '2083-07', upTo: '2026-10-29' },
  feesOutstanding: { amount: 184_290_000, studentCount: 212 },
  spentToday: { amount: 745_000, entryCount: 3 },
  accounts: [
    { id: '1d1e7c51-2b7a-4f0e-9a1d-0c3b5a7e9f10', name: 'Current account', kind: 'bank', bankName: 'Nabil Bank', accountNoLast4: '4521', balance: 148_677_500, belowZero: false },
    { id: '2e2f8d62-3c8b-4a1f-8b2e-1d4c6b8f0a21', name: 'Cash', kind: 'cash', bankName: null, accountNoLast4: null, balance: 11_234_000, belowZero: false },
  ],
  todaysExpenses: [
    { id: '3f3a9e73-4d9c-4b2a-9c3f-2e5d7c9a1b32', description: 'Electricity bill', categoryName: 'Utilities', accountKind: 'bank', status: 'posted', amount: 520_000 },
    { id: '4a4b0f84-5e0d-4c3b-8d4a-3f6e8d0b2c43', description: 'Whiteboard markers and chalk', categoryName: 'Stationery', accountKind: 'cash', status: 'void_requested', amount: 145_000 },
  ],
  dayClose: { expectedCash: 11_234_000, last: null },
  voidRequests: [],
  collectedToday: { amount: 4_860_000, receiptCount: 31, byMethod: [], receiptCountByYou: 26 },
  latestReceipts: [
    {
      paymentId: '5b5c1a95-6f1e-4d4c-9e5b-4a7f9e1c3d54',
      receiptNo: '2083/84-001284',
      takenAt: '2026-10-29T05:07:00.000Z',
      takenBy: 'Bikash Thapa',
      student: student('6c6d2ba6-7a2f-4e5d-8f6c-5b8a0f2d4e65', 'Aarav Shrestha', 'Class 5', 'A'),
      method: 'fonepay',
      status: 'posted',
      amount: 440_000,
      lines: [{ label: 'Monthly tuition, Kartik 2083', amount: 440_000 }],
      extraOriginalsAllowed: 0,
    },
    {
      paymentId: '7d7e3cb7-8b3a-4f6e-9a7d-6c9b1a3e5f76',
      receiptNo: '2083/84-001271',
      takenAt: '2026-10-29T04:02:00.000Z',
      takenBy: 'Bikash Thapa',
      student: student('8e8f4dc8-9c4b-4a7f-8b8e-7d0c2b4f6a87', 'Kiran Ghimire', 'Class 9', 'A'),
      method: 'cash',
      status: 'void_requested',
      amount: 355_000,
      lines: [{ label: 'Monthly tuition, Kartik 2083', amount: 355_000 }],
      extraOriginalsAllowed: 0,
    },
  ],
  collectionByDay: [
    { date: '2026-10-19', amount: 9_300_000 },
    { date: '2026-10-20', amount: 8_000_000 },
    { date: '2026-10-29', amount: 4_860_000 },
  ],
  largestDues: [
    {
      student: student('9f9a5ed9-0d5c-4b8a-9c9f-8e1d3c5a7b98', 'Bibek Lama', 'Class 7', 'A'),
      amount: 546_000,
      items: [
        { kind: 'fee', headName: 'Monthly tuition', periodLabel: 'Ashwin 2083', partPaid: true },
        { kind: 'fee', headName: 'Monthly tuition', periodLabel: 'Kartik 2083', partPaid: false },
        { kind: 'fine', headName: 'Monthly tuition', periodLabel: 'Ashwin 2083', partPaid: false },
      ],
    },
  ],
}

export const SITA = {
  id: '0a0b6fea-1e6d-4c9b-8d0a-9f2e4d6b8c09',
  fullName: 'Sita Gurung',
  className: 'Class 4',
  sectionName: 'B',
  code: 'MEMS-2079-0123',
  rollNo: 12,
  status: 'active',
  guardianName: 'Hari Gurung',
  guardianPhone: '9841234567',
  outstanding: 360_000,
}

export const TEST_PDF = new TextEncoder().encode('%PDF-1.7 test receipt')

// Sita owes this month's tuition, due by 15 Kartik 2083 (1 Nov 2026).
const SITA_DUES = {
  studentId: SITA.id,
  items: [
    {
      kind: 'fee',
      feeDueId: '1b1c7a0b-2f7e-4dac-9e1b-0a3f5e7c9d10',
      headName: 'Monthly tuition',
      periodLabel: 'Kartik 2083',
      dueDate: '2026-11-01',
      amount: 360_000,
      discount: 0,
      paid: 0,
      remaining: 360_000,
    },
  ],
  total: 360_000,
}

// The signed-in routes of the Accountant's frame, for a Computer 1 made by computer1WithSignIn.
export function frameRoutes(request: ServerRequest): ServerReply | null {
  if (request.path === '/receipts/test') {
    return { reached: true, status: 200, contentType: 'application/pdf', body: TEST_PDF }
  }
  if (request.path === '/dashboard/finance') {
    return json(200, FINANCE_DASHBOARD)
  }
  if (request.path === `/students/${SITA.id}/dues`) {
    return json(200, SITA_DUES)
  }
  if (request.path.startsWith('/students?')) {
    const q = new URLSearchParams(request.path.split('?')[1]).get('q') ?? ''
    return json(200, { students: 'sita gurung 9841234567'.includes(q.toLowerCase()) ? [SITA] : [] })
  }
  return null
}
