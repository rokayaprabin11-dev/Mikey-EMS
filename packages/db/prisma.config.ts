import { existsSync } from 'node:fs'
import { defineConfig } from 'prisma/config'

const serverEnvFile = new URL('../../apps/server/.env', import.meta.url)
if (process.env.DATABASE_URL === undefined && existsSync(serverEnvFile)) {
  process.loadEnvFile(serverEnvFile)
}

// Generating the client needs no database, so only migrations require DATABASE_URL.
const databaseUrl = process.env.DATABASE_URL

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  ...(databaseUrl === undefined ? {} : { datasource: { url: databaseUrl } }),
})
