import { z } from 'zod'

import { formatRupees } from './money.ts'

// Every error the server can send: its HTTP status and the message the user sees. The server
// builds every error reply from this list, and the desktop gets the codes as a type. Messages are
// in English (`en`); a Nepali message can be added beside each one later.

interface ErrorDefinition {
  status: 400 | 401 | 403 | 404 | 409 | 422 | 500
  en: (params: never) => string
}

function minutes(count: number): string {
  return `${count} ${count === 1 ? 'minute' : 'minutes'}`
}

export const ERRORS = {
  VALIDATION_FAILED: { status: 400, en: () => 'Some of the information sent was not valid.' },
  BAD_REQUEST: { status: 400, en: () => 'Computer 1 could not read the request.' },
  NOT_SIGNED_IN: { status: 401, en: () => 'Sign in to continue.' },
  SESSION_EXPIRED: {
    status: 401,
    en: (params: { idleMinutes: number } | { hours: number }) =>
      'idleMinutes' in params
        ? `You were signed out because the app was not used for ${minutes(params.idleMinutes)}. Sign in again.`
        : `You were signed out because you were signed in for ${params.hours} hours. Sign in again.`,
  },
  WRONG_USERNAME_OR_PASSWORD: {
    status: 401,
    en: () => 'The username or password is not right. Check both and try again.',
  },
  ACCOUNT_LOCKED: {
    status: 403,
    en: (params: { minutes: number }) => `Too many wrong passwords. Try again in ${minutes(params.minutes)}.`,
  },
  ACCOUNT_INACTIVE: { status: 403, en: () => 'This account is switched off. Ask the Super Admin to switch it on.' },
  NOT_ALLOWED: {
    status: 403,
    en: () => 'Computer 1 does not know this computer yet. Ask the Super Admin to allow it in Settings, Office network.',
  },
  NOT_ON_LOCAL_NETWORK: { status: 403, en: () => 'Only computers on the school office network can ask to connect.' },
  NO_PERMISSION: { status: 403, en: () => 'You do not have permission to do this. Ask the Super Admin.' },
  NOT_FOUND: {
    status: 404,
    en: (params: { what: 'address' | 'student' | 'due' | 'receipt' | 'request' | 'computer' }) =>
      ({
        address: 'Computer 1 does not understand this request. Make sure both computers have the same version of Mikey EMS.',
        student: 'This student was not found. Refresh the list and try again.',
        due: 'One of the chosen dues was not found for this student. Refresh the dues and try again.',
        receipt: 'This receipt was not found. Refresh the list and try again.',
        request: 'This request was not found. Refresh the list and try again.',
        computer: 'This computer was not found. Refresh the list and try again.',
      })[params.what],
  },
  REQUEST_NOT_PENDING: {
    status: 409,
    en: () => 'This request was already answered or has expired. Refresh the list.',
  },
  ALREADY_ALLOWED: { status: 409, en: () => 'This computer is already allowed.' },
  ALREADY_REMOVED: { status: 409, en: () => 'This computer was already removed. Refresh the list.' },
  ALWAYS_ALLOWED: { status: 422, en: () => 'This address is Computer 1 itself, which is always allowed.' },
  CONNECTION_REQUESTS_FULL: {
    status: 422,
    en: () => 'Computer 1 has too many requests waiting. Ask the Super Admin to answer them first.',
  },
  DUE_NOT_OWED: {
    status: 409,
    en: (params: { item: string }) =>
      `${params.item} is no longer owed: it was cancelled, or the fine was waived. Refresh the dues and try again.`,
  },
  DUE_ALREADY_PAID: {
    status: 409,
    en: (params: { item: string }) =>
      `${params.item} has already been paid, perhaps at the other counter. Refresh the dues and try again.`,
  },
  AMOUNT_EXCEEDS_DUE: {
    status: 422,
    en: (params: { item: string; amount: number; remaining: number }) =>
      `${formatRupees(params.amount)} is more than the ${formatRupees(params.remaining)} still due on ${params.item}. Advance payments are not taken.`,
  },
  ACCOUNT_NOT_SET_UP: {
    status: 422,
    en: (params: { kind: 'cash' | 'bank'; several: boolean }) => {
      if (params.kind === 'cash') {
        return params.several
          ? 'Computer 1 has more than one cash account, so this version cannot choose one. Ask the Super Admin.'
          : 'There is no cash account on Computer 1. Ask the Super Admin to set one up.'
      }
      return params.several
        ? 'Computer 1 has more than one bank account, so this version cannot choose which one this payment goes into. Ask the Super Admin.'
        : 'There is no bank account on Computer 1 for this payment. Ask the Super Admin to add one, or take cash.'
    },
  },
  STUDENT_NOT_IN_CLASS: {
    status: 422,
    en: () => 'This student is not in any class, so a receipt cannot show their class. Ask the Super Admin to put them in one.',
  },
  SCHOOL_NOT_SET_UP: {
    status: 422,
    en: () => 'The school name has not been saved on Computer 1 yet, so receipts cannot be made. Finish Computer 1 setup first.',
  },
  ALREADY_PRINTED: {
    status: 409,
    en: () => 'The original of this receipt has already been printed. Print a copy instead.',
  },
  INTERNAL_ERROR: {
    status: 500,
    en: () => 'Something went wrong on Computer 1. Try again. If it happens again, tell the Super Admin.',
  },
} as const satisfies Record<string, ErrorDefinition>

export type ErrorCode = keyof typeof ERRORS

/** What each code's message needs, as arguments: none, or one object. */
export type ErrorParams<C extends ErrorCode> = Parameters<(typeof ERRORS)[C]['en']>

export const errorCodeSchema = z.custom<ErrorCode>(
  (value) => typeof value === 'string' && Object.hasOwn(ERRORS, value),
  'Not an error code from the shared list.',
)

export function errorMessage<C extends ErrorCode>(code: C, ...params: ErrorParams<C>): string {
  const english = ERRORS[code].en as (...args: ErrorParams<C>) => string
  return english(...params)
}
