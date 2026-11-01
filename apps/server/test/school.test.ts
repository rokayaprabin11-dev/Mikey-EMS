import type { User } from '@mikey/db'
import { schoolResponseSchema } from '@mikey/shared'
import PDFDocument from 'pdfkit'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { allowComputer, createUser, ensureSchool, errorOf, SCHOOL_PROFILE, signIn, startTestServer, type TestServer } from './support.ts'

// The Accountant works on Computer 2.
const COUNTER = '192.168.1.88'

const server: TestServer = startTestServer()
let admin: User
let accountant: User

beforeAll(async () => {
  admin = await createUser(server.db, 'super_admin')
  accountant = await createUser(server.db, 'accountant')
  await allowComputer(server.db, COUNTER, admin)
})

afterAll(() => server.close())

async function school(token?: string, ip = COUNTER) {
  const response = await server.call({ method: 'GET', path: '/school', ip, ...(token === undefined ? {} : { token }) })
  expect(response.statusCode, response.body).toBe(200)
  return schoolResponseSchema.parse(response.json())
}

describe('the school', () => {
  it('is empty until Computer 1 setup has saved it', async () => {
    expect(await school()).toEqual({ name: null, details: null })
  })

  it('gives an allowed computer its name before sign-in, and its contact details once signed in', async () => {
    await ensureSchool(server.db)
    expect(await school()).toEqual({ name: SCHOOL_PROFILE.name, details: null })

    const token = await signIn(server, accountant, COUNTER)
    const { name, ...details } = SCHOOL_PROFILE
    expect(await school(token)).toEqual({ name, details })

    // A session that has ended, or a token that never was one, is just "not signed in".
    expect((await server.call({ method: 'POST', path: '/auth/logout', ip: COUNTER, token })).statusCode).toBe(204)
    expect(await school(token)).toEqual({ name, details: null })
    expect(await school('not-a-token')).toEqual({ name, details: null })
  })

  it('is not given to a computer that is not allowed', async () => {
    const response = await server.call({ method: 'GET', path: '/school', ip: '192.168.1.200' })
    expect(errorOf(response)).toMatchObject({ status: 403, code: 'NOT_ALLOWED' })
  })
})

// @types/pdfkit types the default export as a document rather than a class with a prototype.
const pdfDocument = (PDFDocument as unknown as { prototype: PDFKit.PDFDocument }).prototype

describe('the test print', () => {
  it("prints the receipt's page marked TEST and not a receipt, and saves nothing", async () => {
    await ensureSchool(server.db)
    const prints = await server.db.receiptPrint.count()
    const receipts = await server.db.receipt.count()
    const text = vi.spyOn(pdfDocument, 'text')
    try {
      const response = await server.call({
        method: 'GET',
        path: '/receipts/test',
        ip: COUNTER,
        token: await signIn(server, accountant, COUNTER),
      })
      expect(response.statusCode, response.body).toBe(200)
      expect(response.headers['content-type']).toBe('application/pdf')
      const drawn = text.mock.calls.map(([value]) => String(value)).join('|')
      for (const expected of [
        SCHOOL_PROFILE.name,
        'Test print, not a receipt',
        'TEST',
        'Test line, to check the printer and the paper',
        'Received by Test Accountant',
        'Computer 2',
      ]) {
        expect(drawn).toContain(expected)
      }
      expect(drawn).not.toContain('Original')
    } finally {
      text.mockRestore()
    }
    expect(await server.db.receiptPrint.count()).toBe(prints)
    expect(await server.db.receipt.count()).toBe(receipts)
  })
})
