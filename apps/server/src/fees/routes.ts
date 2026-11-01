import { toPaisaNumber } from '@mikey/shared'
import type { FastifyInstance } from 'fastify'

import type { AppDeps } from '../deps.ts'
import { fail } from '../errors.ts'
import { registerRoute } from '../http/route.ts'
import { collectPayment, previewPayment } from './collect.ts'
import { owedItems, readLedger } from './ledger.ts'
import { listPayments } from './payments.ts'
import { allowOriginal, printOriginal, printTestReceipt, readReceipt, reprint } from './receipts.ts'
import { approveVoid, declineVoid, listVoidRequests, requestVoid, voidDirectly } from './voids.ts'

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

  registerRoute(app, deps, 'previewPayment', ({ body }) => previewPayment(deps.db, body))

  registerRoute(app, deps, 'printReceipt', (input) => printOriginal(deps, input))

  registerRoute(app, deps, 'reprintReceipt', (input) => reprint(deps, input))

  registerRoute(app, deps, 'testReceipt', (input) => printTestReceipt(deps, input))

  registerRoute(app, deps, 'allowOriginalPrint', (input) => allowOriginal(deps, input))

  registerRoute(app, deps, 'listPayments', ({ query, session }) => listPayments(deps.db, query, session))

  registerRoute(app, deps, 'getPayment', ({ params }) => readReceipt(deps.db, params.paymentId))

  registerRoute(app, deps, 'requestVoid', (input) => requestVoid(deps, input))

  registerRoute(app, deps, 'listMyVoidRequests', async ({ session }) => ({
    voidRequests: await listVoidRequests(deps.db, { requestedById: session.user.id }, 'desc'),
  }))

  registerRoute(app, deps, 'listPendingVoidRequests', async () => ({
    voidRequests: await listVoidRequests(deps.db, { status: 'pending' }, 'asc'),
  }))

  registerRoute(app, deps, 'voidDirectly', (input) => voidDirectly(deps, input))

  registerRoute(app, deps, 'approveVoid', (input) => approveVoid(deps, input))

  registerRoute(app, deps, 'declineVoid', (input) => declineVoid(deps, input))
}
