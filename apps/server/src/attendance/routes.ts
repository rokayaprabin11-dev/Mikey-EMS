import type { FastifyInstance } from 'fastify'

import type { AppDeps } from '../deps.ts'
import { registerRoute } from '../http/route.ts'
import { attendanceSummary } from './summary.ts'

export function registerAttendanceRoutes(app: FastifyInstance, deps: AppDeps): void {
  registerRoute(app, deps, 'attendanceSummary', ({ query, now }) => attendanceSummary(deps.db, query.date, now))
}
