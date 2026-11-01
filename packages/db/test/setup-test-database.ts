import type { TestProject } from 'vitest/node'

import { createFreshTestDatabase, dropTestDatabase } from '../src/testing.ts'

declare module 'vitest' {
  export interface ProvidedContext {
    testDatabaseUrl: string
  }
}

// The test database is dropped when the run ends. A run that crashes leaves it, and the next run
// drops and makes it again, so there is never more than one.
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const url = await createFreshTestDatabase('mikeyems_test')
  project.provide('testDatabaseUrl', url)
  return () => dropTestDatabase(url, 'mikeyems_test')
}
