import { ERRORS, type ErrorBody, type ErrorCode, errorMessage, type ErrorParams } from '@mikey/shared'

export class AppError extends Error {
  readonly code: ErrorCode
  readonly status: number
  readonly details: Record<string, unknown>

  constructor(code: ErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.status = ERRORS[code].status
    this.details = details
  }

  withDetails(details: Record<string, unknown>): AppError {
    return new AppError(this.code, this.message, details)
  }

  toBody(): ErrorBody {
    return { error: { code: this.code, message: this.message, details: this.details } }
  }
}

// Every error reply is built from the shared list in packages/shared/src/errors.ts.
export function fail<C extends ErrorCode>(code: C, ...params: ErrorParams<C>): AppError {
  return new AppError(code, errorMessage(code, ...params))
}
