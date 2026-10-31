import Fastify, { type FastifyInstance } from 'fastify'

import { registerAuthRoutes } from './auth/routes.ts'
import type { AppDeps } from './deps.ts'
import { AppError, errors } from './errors.ts'
import { registerFeeRoutes } from './fees/routes.ts'
import { registerConnectionRoutes } from './system/connections.ts'
import { registerHealthRoute } from './system/health.ts'

// Fastify's own refusals, such as a body that is not valid JSON, carry a 4xx status code.
function isRefusedByFastify(error: unknown): boolean {
  return (
    error instanceof Error &&
    'statusCode' in error &&
    typeof error.statusCode === 'number' &&
    error.statusCode >= 400 &&
    error.statusCode < 500
  )
}

export function buildApp(deps: AppDeps, options: { logger: boolean }): FastifyInstance {
  const app = Fastify({ logger: options.logger })

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.status).send(error.toBody())
    }
    if (isRefusedByFastify(error)) {
      return reply.code(400).send(errors.badRequest().toBody())
    }
    request.log.error(error)
    return reply.code(500).send(errors.internal().toBody())
  })
  app.setNotFoundHandler((_request, reply) => reply.code(404).send(errors.routeNotFound().toBody()))

  registerHealthRoute(app, deps)
  registerAuthRoutes(app, deps)
  registerConnectionRoutes(app, deps)
  registerFeeRoutes(app, deps)
  return app
}
