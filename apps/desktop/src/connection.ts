import type { HealthResponse } from '@mikey/shared'

import { ApiError, ReplyNotUnderstoodError, UnreachableError } from './api/client.ts'
import { en } from './i18n/en.ts'

// Something that stops this computer working with Computer 1, as the screens show it: what
// happened, what to do, and the technical details for "Copy error details".
export interface Problem {
  title: string
  help: string | null
  details: string
}

// `address` is the server address as the screens show it (server-address.ts, addressOf).
export function problemOf(error: unknown, address: string): Problem {
  if (error instanceof UnreachableError) {
    return { title: en.connection.unreachable(address), help: en.connection.unreachableHelp, details: error.reason }
  }
  if (error instanceof ReplyNotUnderstoodError) {
    return { title: en.connection.notUnderstood, help: en.connection.notUnderstoodHelp, details: error.reason }
  }
  if (error instanceof ApiError) {
    return { title: error.message, help: null, details: `${error.code}, HTTP ${error.status}` }
  }
  throw error
}

// Computer 1 answered, but without its database nothing can be done (ARCHITECTURE.md, Health).
export function databaseDownProblem(health: HealthResponse & { db: 'down' }): Problem {
  return { title: en.connection.databaseDown, help: en.connection.databaseDownHelp, details: `db down at ${health.time}` }
}

export interface DetailsContext {
  version: string | undefined
  computerName: string | undefined
  serverUrl: string
  at: Date
}

// What "Copy error details" copies, for whoever looks after the computers.
export function errorDetails(problem: Problem, context: DetailsContext): string {
  return [
    `Mikey EMS ${context.version ?? '?'} on ${context.computerName ?? '?'}`,
    `Server address: ${context.serverUrl}`,
    `Time: ${context.at.toISOString()}`,
    `Problem: ${problem.title}`,
    `Details: ${problem.details}`,
  ].join('\n')
}
