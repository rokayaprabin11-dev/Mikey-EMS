import type { TestProject } from 'vitest/node'

import { createFreshTestDatabase } from '../src/testing.ts'

declare module 'vitest' {
  export interface ProvidedContext {
    testDatabaseUrl: string
  }
}

export default async function setup(project: TestProject): Promise<void> {
  project.provide('testDatabaseUrl', await createFreshTestDatabase('mikeyems_test'))
}
