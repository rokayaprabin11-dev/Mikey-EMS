import type { NetworkInterfaceInfo } from 'node:os'

import type { Prisma, PrismaClient } from '@mikey/db'

export interface AppDeps {
  db: PrismaClient
  clock: () => Date
  hostname: () => string
  networkInterfaces: () => NetworkInterfaceInfo[]
}

// The database itself, or the transaction a change runs in.
export type Db = PrismaClient | Prisma.TransactionClient
