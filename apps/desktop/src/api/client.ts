import { type Endpoint, type EndpointName, endpoints, errorBodySchema, type ErrorCode } from '@mikey/shared'
import type { z, ZodType } from 'zod'

import type { ServerReply, ServerRequest } from '../../electron/bridge.ts'
import { bridge } from '../bridge.ts'
import { en } from '../i18n/en.ts'

// The one way the screens talk to Computer 1. Each call is checked against the shared contract
// (packages/shared/src/api/contract.ts): the request before it is sent, and the reply before it
// is used.

type Definition<N extends EndpointName> = (typeof endpoints)[N]

type Part<N extends EndpointName, K extends 'params' | 'query' | 'body'> =
  Definition<N> extends Record<K, infer S extends ZodType> ? Record<K, z.input<S>> : Record<never, never>

export type CallInput<N extends EndpointName> = Part<N, 'params'> & Part<N, 'query'> & Part<N, 'body'>

export type CallOutput<N extends EndpointName> = Definition<N>['response'] extends ZodType
  ? z.output<Definition<N>['response']>
  : Definition<N>['response'] extends 'empty'
    ? undefined
    : Uint8Array

export interface CallOptions {
  timeoutMs?: number
}

type CallArgs<N extends EndpointName> = keyof CallInput<N> extends never
  ? [options?: CallOptions]
  : [input: CallInput<N>, options?: CallOptions]

// Computer 1 answered with an error from packages/shared/src/errors.ts. The message is written
// for the person at the counter.
export class ApiError extends Error {
  readonly code: ErrorCode
  readonly status: number
  readonly details: Record<string, unknown>

  constructor(code: ErrorCode, message: string, status: number, details: Record<string, unknown>) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.details = details
  }
}

// No reply came back from Computer 1. `reason` is for "Copy error details".
export class UnreachableError extends Error {
  readonly reason: string

  constructor(reason: string) {
    super(en.api.unreachable)
    this.name = 'UnreachableError'
    this.reason = reason
  }
}

// A reply came that this app cannot read, which usually means the two computers have different
// versions of the app.
export class ReplyNotUnderstoodError extends Error {
  readonly reason: string

  constructor(reason: string) {
    super(en.api.notUnderstood)
    this.name = 'ReplyNotUnderstoodError'
    this.reason = reason
  }
}

const DEFAULT_TIMEOUT_MS = 15_000

// Routes open before sign-in never get the session token.
const WITHOUT_SESSION = new Set(['anyone', 'local_network', 'allowed_computer'])

const CONTENT_TYPES = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
} as const

type RawInput = Partial<Record<'params' | 'query' | 'body', unknown>>

function check(name: string, part: string, schema: ZodType | undefined, value: unknown): void {
  if (schema === undefined && value === undefined) {
    return
  }
  const result = schema?.safeParse(value)
  if (result?.success !== true) {
    throw new Error(`The ${part} for ${name} does not match the API contract: ${result?.error.message ?? 'it takes none'}`)
  }
}

function strings(name: string, part: string, value: unknown): Record<string, string> {
  const entries = Object.entries(value ?? {}).filter((entry): entry is [string, unknown] => entry[1] !== undefined)
  for (const [key, item] of entries) {
    if (typeof item !== 'string') {
      throw new Error(`The ${part} ${key} for ${name} must be text.`)
    }
  }
  return Object.fromEntries(entries) as Record<string, string>
}

function pathOf(name: string, endpoint: Endpoint, input: RawInput): string {
  const params = strings(name, 'path parameter', input.params)
  const path = endpoint.path.replace(/:(\w+)/g, (_match, key: string) => encodeURIComponent(params[key] ?? ''))
  const query = new URLSearchParams(strings(name, 'query value', input.query)).toString()
  return query === '' ? path : `${path}?${query}`
}

function json(reply: ServerReply & { reached: true }): unknown {
  const text = new TextDecoder().decode(reply.body)
  try {
    return JSON.parse(text)
  } catch {
    throw new ReplyNotUnderstoodError(`HTTP ${reply.status}, not JSON: ${text.slice(0, 200)}`)
  }
}

function errorOf(reply: ServerReply & { reached: true }): Error {
  const parsed = errorBodySchema.safeParse(json(reply))
  if (!parsed.success) {
    return new ReplyNotUnderstoodError(`HTTP ${reply.status}, not an error reply: ${parsed.error.message}`)
  }
  const { code, message, details } = parsed.data.error
  return new ApiError(code, message, reply.status, details)
}

function readReply(name: string, response: Endpoint['response'], reply: ServerReply & { reached: true }): unknown {
  if (response === 'empty') {
    return undefined
  }
  if (response === 'pdf' || response === 'xlsx') {
    if (!reply.contentType.startsWith(CONTENT_TYPES[response])) {
      throw new ReplyNotUnderstoodError(`${name} sent ${reply.contentType || 'no content type'}, not ${response}.`)
    }
    return reply.body
  }
  const parsed = response.safeParse(json(reply))
  if (!parsed.success) {
    throw new ReplyNotUnderstoodError(`${name} does not match the API contract: ${parsed.error.message}`)
  }
  return parsed.data
}

export function createApiClient(send: (request: ServerRequest) => Promise<ServerReply>) {
  // Kept in memory only, so the app asks for sign-in again after a restart (ARCHITECTURE.md).
  let token: string | null = null

  async function call<N extends EndpointName>(name: N, ...args: CallArgs<N>): Promise<CallOutput<N>> {
    const endpoint: Endpoint = endpoints[name]
    const takesInput = endpoint.params !== undefined || endpoint.query !== undefined || endpoint.body !== undefined
    const [input, options] = (takesInput ? args : [{}, args[0]]) as [RawInput, CallOptions | undefined]
    check(name, 'path parameters', endpoint.params, input.params)
    check(name, 'query', endpoint.query, input.query)
    check(name, 'body', endpoint.body, input.body)

    const reply = await send({
      method: endpoint.method,
      path: pathOf(name, endpoint, input),
      token: WITHOUT_SESSION.has(endpoint.access) ? null : token,
      body: input.body === undefined ? null : JSON.stringify(input.body),
      timeoutMs: options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    })
    if (!reply.reached) {
      throw new UnreachableError(reply.reason)
    }
    if (reply.status < 200 || reply.status > 299) {
      throw errorOf(reply)
    }
    return readReply(name, endpoint.response, reply) as CallOutput<N>
  }

  return {
    call,
    setToken(value: string | null): void {
      token = value
    },
  }
}

export const api = createApiClient((request) => bridge().request(request))
