import type { Prisma } from '@mikey/db'

import type { Db } from './deps.ts'

export interface AuditEntry {
  at: Date
  userId: string | null
  computer: 1 | 2
  action: string
  area: string
  summary: string
  recordType?: string
  recordId?: string
  before?: Prisma.InputJsonValue
  after?: Prisma.InputJsonValue
}

export async function writeAudit(db: Db, entry: AuditEntry): Promise<void> {
  await db.auditLog.create({ data: entry })
}
