import type { Account as AccountRow } from '@mikey/db'
import { type AccountsResponse, type AdDate, toPaisaNumber } from '@mikey/shared'

import { toDbDate } from '../dates.ts'
import type { Db } from '../deps.ts'
import { fail } from '../errors.ts'

// There is one cash account and, in this version, one bank account. With none, or more than one,
// the server cannot choose, so it says so instead of guessing.
export async function onlyAccount(tx: Db, kind: 'cash' | 'bank'): Promise<AccountRow> {
  const accounts = await tx.account.findMany({ where: { kind }, take: 2 })
  const [account] = accounts
  if (account !== undefined && accounts.length === 1) {
    return account
  }
  throw fail('ACCOUNT_NOT_SET_UP', { kind, several: accounts.length > 1 })
}

// Anything that takes money out of an account locks the account row first, so two of them can
// never both spend the same cash.
export async function lockAccount(tx: Db, accountId: string): Promise<AccountRow> {
  await tx.$executeRaw`SELECT id FROM accounts WHERE id = ${accountId}::uuid FOR UPDATE`
  const account = await tx.account.findUnique({ where: { id: accountId } })
  if (account === null) {
    throw fail('NOT_FOUND', { what: 'account' })
  }
  return account
}

function entryDateFilter(dates: { before?: AdDate; through?: AdDate }): { lt: Date } | { lte: Date } | undefined {
  if (dates.before !== undefined) {
    return { lt: toDbDate(dates.before) }
  }
  return dates.through === undefined ? undefined : { lte: toDbDate(dates.through) }
}

// Balance = money in minus money out over the account's entries; there is no balance column.
export async function balanceOf(db: Db, accountId: string, dates: { before?: AdDate; through?: AdDate } = {}): Promise<bigint> {
  const entryDate = entryDateFilter(dates)
  const rows = await db.accountEntry.groupBy({
    by: ['direction'],
    where: { accountId, ...(entryDate === undefined ? {} : { entryDate }) },
    _sum: { amountPaisa: true },
  })
  const total = (direction: 'in' | 'out') => rows.find((row) => row.direction === direction)?._sum.amountPaisa ?? 0n
  return total('in') - total('out')
}

export async function listAccounts(db: Db): Promise<AccountsResponse> {
  const accounts = await db.account.findMany({ orderBy: [{ kind: 'asc' }, { name: 'asc' }] })
  const result: AccountsResponse['accounts'] = []
  for (const account of accounts) {
    const balance = await balanceOf(db, account.id)
    result.push({
      id: account.id,
      name: account.name,
      kind: account.kind,
      bankName: account.bankName,
      accountNoLast4: account.accountNoLast4,
      balance: toPaisaNumber(balance),
      belowZero: balance < 0n,
    })
  }
  return { accounts: result }
}
