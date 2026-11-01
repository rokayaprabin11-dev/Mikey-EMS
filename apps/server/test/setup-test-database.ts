import { createDb } from '@mikey/db'
import { createFreshTestDatabase, dropTestDatabase } from '@mikey/db/testing'
import { ACCOUNTANT_DEFAULT_PERMISSIONS, PERMISSION_KEYS } from '@mikey/shared'
import type { TestProject } from 'vitest/node'

declare module 'vitest' {
  export interface ProvidedContext {
    testDatabaseUrl: string
  }
}

// The template and the copy each test file works in (own-database.ts) are dropped when the run
// ends. A run that crashes leaves them, and the next run drops and makes them again, so there is
// never more than one of each.
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const url = await createFreshTestDatabase('mikeyems_test_server')
  const db = createDb(url)
  try {
    await db.role.create({
      data: { name: 'super_admin', permissions: { create: PERMISSION_KEYS.map((permissionKey) => ({ permissionKey })) } },
    })
    await db.role.create({
      data: {
        name: 'accountant',
        permissions: { create: ACCOUNTANT_DEFAULT_PERMISSIONS.map((permissionKey) => ({ permissionKey })) },
      },
    })
  } finally {
    await db.$disconnect()
  }
  project.provide('testDatabaseUrl', url)
  return async () => {
    await dropTestDatabase(url, 'mikeyems_test_file')
    await dropTestDatabase(url, 'mikeyems_test_server')
  }
}
