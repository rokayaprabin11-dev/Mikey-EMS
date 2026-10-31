export interface ServerConfig {
  host: string
  port: number
  databaseUrl: string
}

const BUSINESS_TIME_ZONE = 'Asia/Kathmandu'

// ICU may report Asia/Kathmandu under its older spelling, Asia/Katmandu.
function canonicalTimeZone(timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone }).resolvedOptions().timeZone
}

export function readConfig(env: Record<string, string | undefined>, timeZone: string): ServerConfig {
  if (canonicalTimeZone(timeZone) !== canonicalTimeZone(BUSINESS_TIME_ZONE)) {
    throw new Error(
      `The server is running in time zone "${timeZone}". Set TZ=${BUSINESS_TIME_ZONE} for the server process and start it again.`,
    )
  }

  const host = env.API_HOST
  if (!host) {
    throw new Error('API_HOST is not set. For development, copy apps/server/.env.example to apps/server/.env.')
  }

  const port = Number(env.API_PORT)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`API_PORT must be a whole number from 1 to 65535, but it is "${env.API_PORT ?? ''}".`)
  }

  const databaseUrl = env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set. For development, copy apps/server/.env.example to apps/server/.env.')
  }
  if (!URL.canParse(databaseUrl) || new URL(databaseUrl).hostname !== '127.0.0.1') {
    throw new Error('DATABASE_URL must point at 127.0.0.1, the only address PostgreSQL listens on.')
  }

  return { host, port, databaseUrl }
}
