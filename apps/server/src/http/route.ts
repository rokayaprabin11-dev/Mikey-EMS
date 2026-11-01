import { type Access, API_PREFIX, type Endpoint, type EndpointName, endpoints } from '@mikey/shared'
import type { FastifyBaseLogger, FastifyInstance } from 'fastify'
import type { z } from 'zod'

import { authenticate, type RequestContext, type SessionContext } from '../auth/sessions.ts'
import type { AppDeps } from '../deps.ts'
import { AppError, fail } from '../errors.ts'
import { isLoopback, isOnLocalNetwork, normalizeIp } from '../network.ts'
import { isAllowedComputer } from '../system/allow-list.ts'

type Definition<N extends EndpointName> = (typeof endpoints)[N]

type Input<N extends EndpointName, K extends 'params' | 'query' | 'body'> =
  Definition<N> extends Record<K, infer S extends z.ZodType> ? z.output<S> : undefined

type Reply<R> = R extends z.ZodType ? z.input<R> : R extends 'empty' ? void : Buffer

type WithSession<A extends Access> = A extends 'anyone' | 'local_network' | 'allowed_computer'
  ? unknown
  : A extends 'optional_sign_in'
    ? { session: SessionContext | null }
    : { session: SessionContext }

type RouteInput<N extends EndpointName> = RequestContext &
  WithSession<Definition<N>['access']> & {
    params: Input<N, 'params'>
    query: Input<N, 'query'>
    body: Input<N, 'body'>
    log: FastifyBaseLogger
  }

type RouteHandler<N extends EndpointName> = (input: RouteInput<N>) => Promise<Reply<Definition<N>['response']>>

function parseInput(schema: z.ZodType | undefined, value: unknown): unknown {
  if (schema === undefined) {
    return undefined
  }
  const result = schema.safeParse(value)
  if (!result.success) {
    throw fail('VALIDATION_FAILED').withDetails({
      issues: result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    })
  }
  return result.data
}

async function checkAccess(
  deps: AppDeps,
  access: Access,
  context: RequestContext,
  authorization: string | undefined,
): Promise<SessionContext | null> {
  if (access === 'anyone') {
    return null
  }
  if (access === 'local_network') {
    if (!isOnLocalNetwork(context.ip, deps.networkInterfaces())) {
      throw fail('NOT_ON_LOCAL_NETWORK')
    }
    return null
  }
  if (!(await isAllowedComputer(deps.db, context.ip))) {
    throw fail('NOT_ALLOWED')
  }
  if (access === 'allowed_computer') {
    return null
  }
  if (access === 'optional_sign_in') {
    // No session, or one that has ended, simply means "not signed in" here.
    if (authorization === undefined) {
      return null
    }
    try {
      return await authenticate(deps, authorization, context)
    } catch (error) {
      if (error instanceof AppError) {
        return null
      }
      throw error
    }
  }
  const session = await authenticate(deps, authorization, context)
  if (access !== 'signed_in' && !session.permissions.has(access)) {
    throw fail('NO_PERMISSION')
  }
  return session
}

const CONTENT_TYPES = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
} as const

export function registerRoute<N extends EndpointName>(
  app: FastifyInstance,
  deps: AppDeps,
  name: N,
  handler: RouteHandler<N>,
): void {
  const endpoint: Endpoint = endpoints[name]
  app.route({
    method: endpoint.method,
    url: API_PREFIX + endpoint.path,
    handler: async (request, reply) => {
      const ip = normalizeIp(request.ip)
      const context: RequestContext = { ip, computer: isLoopback(ip) ? 1 : 2, now: deps.clock() }
      const session = await checkAccess(deps, endpoint.access, context, request.headers.authorization)
      const input = {
        ...context,
        ...(session === null && endpoint.access !== 'optional_sign_in' ? {} : { session }),
        params: parseInput(endpoint.params, request.params),
        query: parseInput(endpoint.query, request.query),
        body: parseInput(endpoint.body, request.body),
        log: request.log,
      }
      const result: unknown = await handler(input as RouteInput<N>)

      const response = endpoint.response
      if (response === 'empty') {
        return reply.code(204).send()
      }
      if (response === 'pdf' || response === 'xlsx') {
        return reply.type(CONTENT_TYPES[response]).send(result)
      }
      const parsed = response.safeParse(result)
      if (!parsed.success) {
        request.log.error({ issues: parsed.error.issues }, `The ${name} response does not match the API contract.`)
        throw new Error(`The ${name} response does not match the API contract.`)
      }
      return reply.send(parsed.data)
    },
  })
}
