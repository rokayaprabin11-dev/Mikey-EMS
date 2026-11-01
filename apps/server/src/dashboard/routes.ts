import type { FastifyInstance } from 'fastify'

import type { AppDeps } from '../deps.ts'
import { registerRoute } from '../http/route.ts'
import { financeDashboard, schoolDashboard } from './dashboard.ts'

export function registerDashboardRoutes(app: FastifyInstance, deps: AppDeps): void {
  registerRoute(app, deps, 'financeDashboard', ({ session, now }) => financeDashboard(deps.db, session, now))

  registerRoute(app, deps, 'schoolDashboard', ({ now }) => schoolDashboard(deps.db, now))
}
