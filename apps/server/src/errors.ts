import type { ErrorBody } from '@mikey/shared'

export class AppError extends Error {
  readonly status: number
  readonly code: string
  readonly details: Record<string, unknown>

  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super(message)
    this.name = 'AppError'
    this.status = status
    this.code = code
    this.details = details
  }

  toBody(): ErrorBody {
    return { error: { code: this.code, message: this.message, details: this.details } }
  }
}

function minutes(count: number): string {
  return `${count} ${count === 1 ? 'minute' : 'minutes'}`
}

export const errors = {
  validationFailed: (issues: { path: string; message: string }[]) =>
    new AppError(400, 'VALIDATION_FAILED', 'Some of the information sent was not valid.', { issues }),
  badRequest: () => new AppError(400, 'BAD_REQUEST', 'Computer 1 could not read the request.'),
  notSignedIn: () => new AppError(401, 'NOT_SIGNED_IN', 'Sign in to continue.'),
  idleSignedOut: (idleMinutes: number) =>
    new AppError(
      401,
      'SESSION_EXPIRED',
      `You were signed out because the app was not used for ${minutes(idleMinutes)}. Sign in again.`,
    ),
  signedInTooLong: (hours: number) =>
    new AppError(401, 'SESSION_EXPIRED', `You were signed out because you were signed in for ${hours} hours. Sign in again.`),
  wrongCredentials: () =>
    new AppError(401, 'WRONG_USERNAME_OR_PASSWORD', 'The username or password is not right. Check both and try again.'),
  accountLocked: (waitMinutes: number) =>
    new AppError(403, 'ACCOUNT_LOCKED', `Too many wrong passwords. Try again in ${minutes(waitMinutes)}.`),
  accountInactive: () =>
    new AppError(403, 'ACCOUNT_INACTIVE', 'This account is switched off. Ask the Super Admin to switch it on.'),
  notAllowed: () =>
    new AppError(
      403,
      'NOT_ALLOWED',
      'Computer 1 does not know this computer yet. Ask the Super Admin to allow it in Settings, Office network.',
    ),
  notOnLocalNetwork: () =>
    new AppError(403, 'NOT_ON_LOCAL_NETWORK', 'Only computers on the school office network can ask to connect.'),
  noPermission: () => new AppError(403, 'NO_PERMISSION', 'You do not have permission to do this. Ask the Super Admin.'),
  notFound: (thing: string) => new AppError(404, 'NOT_FOUND', `${thing} was not found. Refresh the list and try again.`),
  routeNotFound: () =>
    new AppError(
      404,
      'NOT_FOUND',
      'Computer 1 does not understand this request. Make sure both computers have the same version of Mikey EMS.',
    ),
  requestNotPending: () =>
    new AppError(409, 'REQUEST_NOT_PENDING', 'This request was already answered or has expired. Refresh the list.'),
  alreadyAllowed: () => new AppError(409, 'ALREADY_ALLOWED', 'This computer is already allowed.'),
  alreadyRemoved: () => new AppError(409, 'ALREADY_REMOVED', 'This computer was already removed. Refresh the list.'),
  alwaysAllowed: () => new AppError(422, 'ALWAYS_ALLOWED', 'This address is Computer 1 itself, which is always allowed.'),
  connectionRequestsFull: () =>
    new AppError(
      422,
      'CONNECTION_REQUESTS_FULL',
      'Computer 1 has too many requests waiting. Ask the Super Admin to answer them first.',
    ),
  internal: () =>
    new AppError(
      500,
      'INTERNAL_ERROR',
      'Something went wrong on Computer 1. Try again. If it happens again, tell the Super Admin.',
    ),
}
