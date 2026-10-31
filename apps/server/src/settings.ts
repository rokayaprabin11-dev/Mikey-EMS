import type { z } from 'zod'

import type { Db } from './deps.ts'

export async function readSetting<T>(db: Db, key: string, schema: z.ZodType<T>): Promise<T | null> {
  const row = await db.setting.findUnique({ where: { key } })
  if (row === null) {
    return null
  }
  const parsed = schema.safeParse(row.value)
  if (!parsed.success) {
    throw new Error(`The setting "${key}" has a value Computer 1 cannot use.`)
  }
  return parsed.data
}
