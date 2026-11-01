import type { FastifyInstance } from 'fastify'

import type { AppDeps } from '../deps.ts'
import { registerRoute } from '../http/route.ts'
import { buildReport } from './data.ts'
import { renderReportExcel } from './excel.ts'
import { renderReportPdf } from './pdf.ts'

export function registerReportRoutes(app: FastifyInstance, deps: AppDeps): void {
  registerRoute(app, deps, 'report', ({ query, session, now }) => buildReport(deps.db, query, session, now))

  registerRoute(app, deps, 'reportPdf', async ({ query, session, now }) => renderReportPdf(await buildReport(deps.db, query, session, now)))

  registerRoute(app, deps, 'reportExcel', async ({ query, session, now }) =>
    renderReportExcel(await buildReport(deps.db, query, session, now)),
  )
}
