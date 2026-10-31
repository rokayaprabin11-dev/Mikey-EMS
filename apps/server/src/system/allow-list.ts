import type { Db } from '../deps.ts'
import { isLoopback } from '../network.ts'

export async function isAllowedComputer(db: Db, ip: string): Promise<boolean> {
  if (isLoopback(ip)) {
    return true
  }
  return (await db.allowedComputer.count({ where: { ip, removedAt: null } })) > 0
}
