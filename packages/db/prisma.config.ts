import { existsSync } from 'node:fs'
import { defineConfig, env } from 'prisma/config'

const serverEnvFile = new URL('../../apps/server/.env', import.meta.url)
if (existsSync(serverEnvFile)) {
  process.loadEnvFile(serverEnvFile)
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: env('DATABASE_URL') },
})
