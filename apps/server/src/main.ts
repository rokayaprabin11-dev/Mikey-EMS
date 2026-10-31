import { hostname, networkInterfaces } from 'node:os'

import { createDb } from '@mikey/db'

import { buildApp } from './app.ts'
import { readConfig } from './config.ts'

const config = readConfig(process.env, Intl.DateTimeFormat().resolvedOptions().timeZone)

const app = buildApp(
  {
    db: createDb(config.databaseUrl),
    clock: () => new Date(),
    hostname,
    networkInterfaces: () => Object.values(networkInterfaces()).flatMap((list) => list ?? []),
  },
  { logger: true },
)
await app.listen({ host: config.host, port: config.port })
