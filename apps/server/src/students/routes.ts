import type { FastifyInstance } from 'fastify'

import type { AppDeps } from '../deps.ts'
import { registerRoute } from '../http/route.ts'
import { searchStudents, studentFees } from './lookup.ts'

export function registerStudentRoutes(app: FastifyInstance, deps: AppDeps): void {
  registerRoute(app, deps, 'classes', async () => ({
    classes: await deps.db.schoolClass.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, sections: { orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], select: { id: true, name: true } } },
    }),
  }))

  registerRoute(app, deps, 'searchStudents', ({ query }) => searchStudents(deps.db, query))

  registerRoute(app, deps, 'studentFees', ({ params }) => studentFees(deps.db, params.studentId))
}
