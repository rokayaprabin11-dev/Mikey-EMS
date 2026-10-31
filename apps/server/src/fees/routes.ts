import { toPaisaNumber } from '@mikey/shared'
import type { FastifyInstance } from 'fastify'

import type { AppDeps } from '../deps.ts'
import { fail } from '../errors.ts'
import { registerRoute } from '../http/route.ts'
import { collectPayment } from './collect.ts'
import { owedItems, readLedger } from './ledger.ts'
import { printOriginal } from './receipts.ts'

export function registerFeeRoutes(app: FastifyInstance, deps: AppDeps): void {
  registerRoute(app, deps, 'studentDues', async ({ params }) => {
    const student = await deps.db.student.findUnique({ where: { id: params.studentId }, select: { id: true } })
    if (student === null) {
      throw fail('NOT_FOUND', { what: 'student' })
    }
    const ledger = await readLedger(deps.db, params.studentId)
    return { studentId: params.studentId, items: owedItems(ledger), total: toPaisaNumber(ledger.outstanding) }
  })

  registerRoute(app, deps, 'collectPayment', (input) => collectPayment(deps, input))

  registerRoute(app, deps, 'printReceipt', (input) => printOriginal(deps, input))
}
