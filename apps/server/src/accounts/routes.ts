import type { FastifyInstance } from 'fastify'

import type { AppDeps } from '../deps.ts'
import { registerRoute } from '../http/route.ts'
import { listAccounts } from './accounts.ts'
import { accountBook } from './book.ts'
import { closeDay, dayCloseStatus, listDayCloses } from './day-close.ts'
import { createMoneyEntry, listCategories, listMoneyEntries } from './money-entries.ts'
import { createTransfer } from './transfers.ts'

export function registerAccountRoutes(app: FastifyInstance, deps: AppDeps): void {
  registerRoute(app, deps, 'expenseCategories', () => listCategories(deps.db, 'expense'))

  registerRoute(app, deps, 'incomeCategories', () => listCategories(deps.db, 'income'))

  registerRoute(app, deps, 'listExpenses', ({ query }) => listMoneyEntries(deps.db, 'expense', query.bsMonth))

  registerRoute(app, deps, 'createExpense', (input) => createMoneyEntry(deps, 'expense', input))

  registerRoute(app, deps, 'listIncomes', ({ query }) => listMoneyEntries(deps.db, 'income', query.bsMonth))

  registerRoute(app, deps, 'createIncome', (input) => createMoneyEntry(deps, 'income', input))

  registerRoute(app, deps, 'listAccounts', () => listAccounts(deps.db))

  registerRoute(app, deps, 'accountBook', ({ params, query }) => accountBook(deps.db, params.accountId, query.date))

  registerRoute(app, deps, 'createTransfer', (input) => createTransfer(deps, input))

  registerRoute(app, deps, 'dayCloseStatus', ({ params }) => dayCloseStatus(deps.db, params.date))

  registerRoute(app, deps, 'closeDay', (input) => closeDay(deps, input))

  registerRoute(app, deps, 'listDayCloses', () => listDayCloses(deps.db))
}
