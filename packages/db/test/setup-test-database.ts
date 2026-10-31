import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import type { TestProject } from 'vitest/node'

import { createDb } from '../src/index.ts'

const TEST_DATABASE = 'mikeyems_test'

declare module 'vitest' {
  export interface ProvidedContext {
    testDatabaseUrl: string
  }
}

function devDatabaseUrl(): string {
  const serverEnvFile = new URL('../../../apps/server/.env', import.meta.url)
  if (process.env.DATABASE_URL === undefined && existsSync(serverEnvFile)) {
    process.loadEnvFile(serverEnvFile)
  }
  const url = process.env.DATABASE_URL
  if (url === undefined) {
    throw new Error(
      'DATABASE_URL is not set. Start the dev database with "docker compose up -d" and copy apps/server/.env.example to apps/server/.env.',
    )
  }
  return url
}

function withDatabase(url: string, database: string): string {
  const copy = new URL(url)
  copy.pathname = `/${database}`
  return copy.toString()
}

// Every run starts from a freshly created database. Dropping it is the only reset: posted rows are
// permanent, and tests never switch the triggers off.
export default async function setup(project: TestProject): Promise<void> {
  const devUrl = devDatabaseUrl()
  const admin = createDb(withDatabase(devUrl, 'postgres'))
  try {
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${TEST_DATABASE}" WITH (FORCE)`)
    await admin.$executeRawUnsafe(`CREATE DATABASE "${TEST_DATABASE}"`)
  } finally {
    await admin.$disconnect()
  }

  const testUrl = withDatabase(devUrl, TEST_DATABASE)
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: 'pipe',
  })
  project.provide('testDatabaseUrl', testUrl)
}
