import { createDb } from '@mikey/db'
import { createFreshTestDatabase } from '@mikey/db/testing'
import { ACCOUNTANT_DEFAULT_PERMISSIONS, PERMISSION_KEYS } from '@mikey/shared'
import type { TestProject } from 'vitest/node'

declare module 'vitest' {
  export interface ProvidedContext {
    testDatabaseUrl: string
  }
}

export default async function setup(project: TestProject): Promise<void> {
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
}
