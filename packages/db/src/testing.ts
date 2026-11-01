import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createDb } from './index.ts'

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

function checkTestDatabaseName(name: string): void {
  if (!/^mikeyems_test(_[a-z]+)?$/.test(name)) {
    throw new Error(`"${name}" is not a test database name.`)
  }
}

// A test database is only ever reset by dropping and recreating it: posted rows are permanent,
// and tests never switch the triggers off.
export async function createFreshTestDatabase(name: `mikeyems_test${string}`): Promise<string> {
  checkTestDatabaseName(name)
  const devUrl = devDatabaseUrl()
  const admin = createDb(withDatabase(devUrl, 'postgres'))
  try {
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`)
  } finally {
    await admin.$disconnect()
  }

  const url = withDatabase(devUrl, name)
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  })
  return url
}

// A fresh copy of a migrated test database, made from it as a template. The template must have no
// open connections while it is copied.
export async function copyTestDatabase(templateUrl: string, name: `mikeyems_test${string}`): Promise<string> {
  const template = new URL(templateUrl).pathname.slice(1)
  checkTestDatabaseName(template)
  checkTestDatabaseName(name)
  const admin = createDb(withDatabase(templateUrl, 'postgres'))
  try {
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}" TEMPLATE "${template}"`)
  } finally {
    await admin.$disconnect()
  }
  return withDatabase(templateUrl, name)
}
