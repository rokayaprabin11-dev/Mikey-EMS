import { describe, expect, it } from 'vitest'

import { dayCloseCreateSchema, transferCreateSchema } from '../src/api/accounts.ts'
import { loginRequestSchema } from '../src/api/auth.ts'
import { bsMonthSchema, errorBodySchema, fiscalYearSchema } from '../src/api/common.ts'
import { endpoints } from '../src/api/contract.ts'
import { collectPaymentRequestSchema, PAYMENT_METHODS, voidRequestCreateSchema } from '../src/api/fees.ts'
import { REPORT_TYPES, reportQuerySchema } from '../src/api/reports.ts'
import { connectionRequestCreateSchema, healthResponseSchema } from '../src/api/system.ts'
import { PERMISSION_KEYS } from '../src/permissions.ts'

const ids = {
  key: '6f1d1c2e-1a2b-4c3d-8e4f-5a6b7c8d9e0f',
  student: '0b5e2f7a-3c4d-4e5f-9a6b-7c8d9e0f1a2b',
  due: '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f',
  fine: '2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a',
  cash: '3e4f5a6b-7c8d-4e9f-8a1b-2c3d4e5f6a7b',
  bank: '4f5a6b7c-8d9e-4f0a-9b2c-3d4e5f6a7b8c',
}

describe('collecting a fee', () => {
  const cashPayment = {
    idempotencyKey: ids.key,
    studentId: ids.student,
    method: 'cash',
    allocations: [
      { kind: 'fee', feeDueId: ids.due, amount: 168_000 },
      { kind: 'fine', fineId: ids.fine, amount: 10_000 },
    ],
  }

  it('accepts a cash payment with no reference', () => {
    expect(collectPaymentRequestSchema.safeParse(cashPayment).success).toBe(true)
  })

  it('refuses a reference on a cash payment', () => {
    expect(collectPaymentRequestSchema.safeParse({ ...cashPayment, reference: 'V-1' }).success).toBe(false)
  })

  it.each(PAYMENT_METHODS.filter((method) => method !== 'cash'))('needs a reference for %s', (method) => {
    expect(collectPaymentRequestSchema.safeParse({ ...cashPayment, method }).success).toBe(false)
    expect(collectPaymentRequestSchema.safeParse({ ...cashPayment, method, reference: 'TXN-881' }).success).toBe(true)
  })

  it('needs at least one due', () => {
    expect(collectPaymentRequestSchema.safeParse({ ...cashPayment, allocations: [] }).success).toBe(false)
  })

  it('refuses the same due twice', () => {
    const twice = [
      { kind: 'fee', feeDueId: ids.due, amount: 100_000 },
      { kind: 'fee', feeDueId: ids.due, amount: 68_000 },
    ]
    expect(collectPaymentRequestSchema.safeParse({ ...cashPayment, allocations: twice }).success).toBe(false)
  })

  it.each([0, -100, 10.5])('refuses an allocation of %d paisa', (amount) => {
    const allocations = [{ kind: 'fee', feeDueId: ids.due, amount }]
    expect(collectPaymentRequestSchema.safeParse({ ...cashPayment, allocations }).success).toBe(false)
  })

  it('needs a UUID idempotency key', () => {
    expect(collectPaymentRequestSchema.safeParse({ ...cashPayment, idempotencyKey: 'abc' }).success).toBe(false)
  })
})

describe('requesting a void', () => {
  const request = {
    target: { type: 'payment', id: ids.due },
    reason: 'wrong_amount',
    details: 'eSewa shows Rs. 3,180 received, not 3,810.',
  }

  it('accepts one of the four reasons with details', () => {
    expect(voidRequestCreateSchema.safeParse(request).success).toBe(true)
  })

  it('needs details for the Super Admin', () => {
    expect(voidRequestCreateSchema.safeParse({ ...request, details: '   ' }).success).toBe(false)
  })

  it('refuses reasons that are not on the list', () => {
    expect(voidRequestCreateSchema.safeParse({ ...request, reason: 'duplicate' }).success).toBe(false)
  })
})

describe('moving money between accounts', () => {
  it('refuses a transfer from an account to itself', () => {
    const transfer = { idempotencyKey: ids.key, fromAccountId: ids.cash, toAccountId: ids.cash, amount: 500_000 }
    expect(transferCreateSchema.safeParse(transfer).success).toBe(false)
    expect(transferCreateSchema.safeParse({ ...transfer, toAccountId: ids.bank }).success).toBe(true)
  })
})

describe('closing the day', () => {
  it('accepts a count of the notes in the drawer', () => {
    const counts = [
      { note: 1000, count: 84 },
      { note: 500, count: 36 },
      { note: 2, count: 0 },
    ]
    expect(dayCloseCreateSchema.safeParse({ counts }).success).toBe(true)
  })

  it.each([
    ['a note Nepal does not print', [{ note: 25, count: 1 }]],
    ['a negative count', [{ note: 100, count: -1 }]],
    ['the same note twice', [{ note: 100, count: 1 }, { note: 100, count: 2 }]],
  ])('refuses %s', (_label, counts) => {
    expect(dayCloseCreateSchema.safeParse({ counts }).success).toBe(false)
  })
})

describe('BS month filters', () => {
  it.each([
    ['2083-07', true],
    ['2083-12', true],
    ['2083-13', false],
    ['2083-7', false],
    ['2091-01', false],
  ])('%s is valid: %s', (value, valid) => {
    expect(bsMonthSchema.safeParse(value).success).toBe(valid)
  })
})

describe('report filters', () => {
  const period = { from: '2026-10-18', to: '2026-11-16' }

  it('takes one of the four reports and a period', () => {
    for (const type of REPORT_TYPES) {
      expect(reportQuerySchema.safeParse({ type, ...period }).success, type).toBe(true)
    }
    expect(reportQuerySchema.safeParse({ type: 'yearly_collection', ...period }).success).toBe(false)
    expect(reportQuerySchema.safeParse({ type: 'expenses', from: period.from }).success).toBe(false)
  })

  it('refuses a date range that ends before it starts', () => {
    expect(reportQuerySchema.safeParse({ type: 'expenses', from: '2026-10-18', to: '2026-11-16' }).success).toBe(true)
    expect(reportQuerySchema.safeParse({ type: 'expenses', from: '2026-11-16', to: '2026-10-18' }).success).toBe(false)
  })
})

describe('fiscal years', () => {
  it('refuses a fiscal year whose two halves do not follow each other', () => {
    expect(fiscalYearSchema.safeParse('2083/84').success).toBe(true)
    expect(fiscalYearSchema.safeParse('2083/85').success).toBe(false)
  })
})

describe('health check', () => {
  const health = {
    server: 'ok',
    db: 'ok',
    device: 'connected',
    lastSyncAt: '2026-10-31T04:55:00.000Z',
    lastAttemptAt: '2026-10-31T04:55:00.000Z',
    cloudBackup: 'not_set_up',
    allowed: false,
    time: '2026-10-31T04:15:12.000Z',
    serverName: 'MIKEY-SERVER',
    schoolName: 'Mikey English Medium School',
  }

  it('reports whether this computer is allowed', () => {
    expect(healthResponseSchema.safeParse(health).success).toBe(true)
    expect(healthResponseSchema.safeParse({ ...health, allowed: undefined }).success).toBe(false)
  })

  it('names the server, and the school once Computer 1 setup has saved it', () => {
    expect(healthResponseSchema.safeParse({ ...health, schoolName: null }).success).toBe(true)
    expect(healthResponseSchema.safeParse({ ...health, serverName: undefined }).success).toBe(false)
  })

  it('says when the device was last pulled and last tried, or nothing when there is no device', () => {
    expect(healthResponseSchema.safeParse({ ...health, device: 'none', lastSyncAt: null, lastAttemptAt: null }).success).toBe(
      true,
    )
    expect(healthResponseSchema.safeParse({ ...health, lastSyncAt: undefined }).success).toBe(false)
    expect(healthResponseSchema.safeParse({ ...health, lastAttemptAt: undefined }).success).toBe(false)
  })

  it('sends only the clock and the server name when the database is down', () => {
    const down = { server: 'ok', db: 'down', time: health.time, serverName: health.serverName }
    expect(healthResponseSchema.parse({ ...down, allowed: true })).toEqual(down)
    expect(healthResponseSchema.safeParse({ ...down, serverName: undefined }).success).toBe(false)
  })
})

describe('signing in', () => {
  it('reads the username without spaces around it and in lowercase', () => {
    expect(loginRequestSchema.parse({ username: '  Bikash.ACC ', password: 'x' })).toEqual({
      username: 'bikash.acc',
      password: 'x',
    })
    expect(loginRequestSchema.safeParse({ username: '   ', password: 'x' }).success).toBe(false)
  })
})

describe('asking to connect', () => {
  it('sends the computer name, and repeats never ask again unless told to', () => {
    expect(connectionRequestCreateSchema.safeParse({ computerName: ' ACCOUNTS-PC ' }).data).toEqual({
      computerName: 'ACCOUNTS-PC',
      askAgain: false,
    })
    expect(connectionRequestCreateSchema.safeParse({ computerName: 'ACCOUNTS-PC', askAgain: true }).data).toEqual({
      computerName: 'ACCOUNTS-PC',
      askAgain: true,
    })
    expect(connectionRequestCreateSchema.safeParse({ computerName: '' }).success).toBe(false)
  })
})

describe('error body', () => {
  it('has a code from the shared list and a message the user can read', () => {
    const body = { error: { code: 'DUE_ALREADY_PAID', message: 'Monthly tuition, Kartik 2083 has already been paid.', details: {} } }
    expect(errorBodySchema.safeParse(body).success).toBe(true)
    expect(errorBodySchema.safeParse({ error: { ...body.error, code: 'SOMETHING_ELSE' } }).success).toBe(false)
    expect(errorBodySchema.safeParse({ error: { ...body.error, code: 'toString' } }).success).toBe(false)
  })
})

describe('API contract', () => {
  const list = Object.values(endpoints)

  it('has one endpoint per method and path', () => {
    const routes = list.map((endpoint) => `${endpoint.method} ${endpoint.path}`)
    expect(new Set(routes).size).toBe(routes.length)
  })

  const noSession = new Set<string>(['anyone', 'local_network', 'allowed_computer'])

  it('names a real permission or one of the access levels', () => {
    const allowed = new Set<string>([...PERMISSION_KEYS, ...noSession, 'signed_in'])
    for (const endpoint of list) {
      expect(allowed.has(endpoint.access)).toBe(true)
    }
  })

  it('lets only health, connection requests and sign-in work without a session', () => {
    const open = list
      .filter((endpoint) => noSession.has(endpoint.access))
      .map((endpoint) => `${endpoint.access} ${endpoint.method} ${endpoint.path}`)
    expect(open.sort()).toEqual([
      'allowed_computer POST /auth/login',
      'anyone GET /health',
      'local_network POST /connection-requests',
    ])
  })
})
