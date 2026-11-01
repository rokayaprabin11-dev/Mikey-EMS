import { api, ApiError, UnreachableError } from '../api/client.ts'

// A request about the session that did not reach Computer 1, or that Computer 1 answered with
// "the session has ended": the connection status and the sign-in screen already say so.
export function isSessionGone(error: unknown): boolean {
  return error instanceof UnreachableError || (error instanceof ApiError && error.status === 401)
}

// Tells Computer 1 the app is in use, which starts the session's idle time again.
export async function keepAlive(): Promise<void> {
  try {
    await api.call('session')
  } catch (error) {
    if (!isSessionGone(error)) {
      throw error
    }
  }
}
