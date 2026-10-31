import Fastify from 'fastify'

import { readConfig } from './config.ts'

const config = readConfig(process.env, Intl.DateTimeFormat().resolvedOptions().timeZone)

const app = Fastify({ logger: true })
await app.listen({ host: config.host, port: config.port })
