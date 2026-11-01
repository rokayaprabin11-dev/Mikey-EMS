import Fastify, { type FastifyInstance } from 'fastify'

import { registerAccountRoutes } from './accounts/routes.ts'
import { registerAttendanceRoutes } from './attendance/routes.ts'
import { registerAuthRoutes } from './auth/routes.ts'
import { registerDashboardRoutes } from './dashboard/routes.ts'
import type { AppDeps } from './deps.ts'
import { AppError, fail } from './errors.ts'
import { registerFeeRoutes } from './fees/routes.ts'
import { registerReportRoutes } from './reports/routes.ts'
import { registerStudentRoutes } from './students/routes.ts'
import { registerConnectionRoutes } from './system/connections.ts'
import { registerHealthRoute } from './system/health.ts'
import { registerSchoolRoute } from './system/school.ts'

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
      return reply.code(400).send(fail('BAD_REQUEST').toBody())
    }
    request.log.error(error)
    return reply.code(500).send(fail('INTERNAL_ERROR').toBody())
  })
  app.setNotFoundHandler((_request, reply) => reply.code(404).send(fail('NOT_FOUND', { what: 'address' }).toBody()))

  registerHealthRoute(app, deps)
  registerSchoolRoute(app, deps)
  registerAuthRoutes(app, deps)
  registerConnectionRoutes(app, deps)
  registerDashboardRoutes(app, deps)
  registerStudentRoutes(app, deps)
  registerFeeRoutes(app, deps)
  registerAccountRoutes(app, deps)
  registerReportRoutes(app, deps)
  registerAttendanceRoutes(app, deps)
  return app
}
