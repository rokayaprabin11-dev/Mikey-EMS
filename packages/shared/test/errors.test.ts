import { describe, expect, it } from 'vitest'

import { ERRORS, errorMessage } from '../src/errors.ts'

describe('the shared error list', () => {
  it('gives every code a stable SCREAMING_SNAKE name and an HTTP status', () => {
    for (const [code, error] of Object.entries(ERRORS)) {
      expect(code).toMatch(/^[A-Z][A-Z0-9_]*$/)
      expect([400, 401, 403, 404, 409, 422, 500]).toContain(error.status)
    }
  })

  it('builds the plain-English message from what each code needs', () => {
    expect(errorMessage('NOT_SIGNED_IN')).toBe('Sign in to continue.')
    expect(errorMessage('ACCOUNT_LOCKED', { minutes: 1 })).toBe('Too many wrong passwords. Try again in 1 minute.')
    expect(errorMessage('ACCOUNT_LOCKED', { minutes: 10 })).toBe('Too many wrong passwords. Try again in 10 minutes.')
    expect(errorMessage('SESSION_EXPIRED', { idleMinutes: 15 })).toBe(
      'You were signed out because the app was not used for 15 minutes. Sign in again.',
    )
    expect(errorMessage('SESSION_EXPIRED', { hours: 12 })).toBe(
      'You were signed out because you were signed in for 12 hours. Sign in again.',
    )
    expect(errorMessage('NOT_FOUND', { what: 'address' })).toBe(
      'Computer 1 does not understand this request. Make sure both computers have the same version of Mikey EMS.',
    )
    expect(errorMessage('AMOUNT_EXCEEDS_DUE', { item: 'Monthly tuition, Kartik 2083', amount: 368_100, remaining: 368_000 })).toBe(
      'Rs. 3,681 is more than the Rs. 3,680 still due on Monthly tuition, Kartik 2083. Advance payments are not taken.',
    )
    expect(errorMessage('ACCOUNT_NOT_SET_UP', { kind: 'bank', several: true })).toContain('more than one bank account')
    expect(errorMessage('ACCOUNT_NOT_SET_UP', { kind: 'cash', several: false })).toBe(
      'There is no cash account on Computer 1. Ask the Super Admin to set one up.',
    )
  })
})
