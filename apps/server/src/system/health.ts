import { schoolProfileSchema } from '@mikey/shared'
import type { FastifyInstance } from 'fastify'

import type { AppDeps, Db } from '../deps.ts'
import { registerRoute } from '../http/route.ts'
import { readSetting } from '../settings.ts'
import { isAllowedComputer } from './allow-list.ts'

// In the devices table last_sync_at is the latest pull attempt and last_success_at the latest pull
// that worked.
interface DevicePulls {
  lastSyncAt: Date | null
  lastSuccessAt: Date | null
}

function lastPullWorked(device: DevicePulls): boolean {
  return device.lastSyncAt !== null && device.lastSuccessAt !== null && device.lastSuccessAt >= device.lastSyncAt
}

function deviceStatus(devices: readonly DevicePulls[]): 'connected' | 'not_responding' | 'none' {
  if (devices.length === 0) {
    return 'none'
  }
  return devices.every(lastPullWorked) ? 'connected' : 'not_responding'
}

// Nothing is connected to a file import, so only devices pulled over a connection count.
export function pulledDevices(db: Db): Promise<DevicePulls[]> {
  return db.device.findMany({
    where: { status: 'active', connection: { not: 'file' } },
    select: { lastSyncAt: true, lastSuccessAt: true },
  })
}

// lastSyncAt: scans from every device are in up to this moment (the oldest of their last pulls
// that worked), or empty while any device has never been pulled. lastAttemptAt: the newest try.
export function pullTimes(devices: readonly DevicePulls[]): { lastSyncAt: string | null; lastAttemptAt: string | null } {
  const successes = devices.flatMap((device) => (device.lastSuccessAt === null ? [] : [device.lastSuccessAt.getTime()]))
  const attempts = devices.flatMap((device) => (device.lastSyncAt === null ? [] : [device.lastSyncAt.getTime()]))
  const everyDeviceWorked = devices.length > 0 && successes.length === devices.length
  return {
    lastSyncAt: everyDeviceWorked ? new Date(Math.min(...successes)).toISOString() : null,
    lastAttemptAt: attempts.length === 0 ? null : new Date(Math.max(...attempts)).toISOString(),
  }
}

export function registerHealthRoute(app: FastifyInstance, deps: AppDeps): void {
  registerRoute(app, deps, 'health', async ({ ip, now, log }) => {
    const time = now.toISOString()
    const serverName = deps.hostname()
    try {
      await deps.db.$queryRaw`SELECT 1`
    } catch (error) {
      log.error(error, 'The database did not answer the health check.')
      return { server: 'ok', db: 'down', time, serverName }
    }

    const [allowed, devices, profile] = await Promise.all([
      isAllowedComputer(deps.db, ip),
      pulledDevices(deps.db),
      readSetting(deps.db, 'school.profile', schoolProfileSchema),
    ])
    return {
      server: 'ok',
      db: 'ok',
      device: deviceStatus(devices),
      ...pullTimes(devices),
      // Cloud backup is set up on Computer 1 by a later build; until then nothing is set up.
      cloudBackup: 'not_set_up',
      allowed,
      time,
      serverName,
      schoolName: profile?.name ?? null,
    }
  })
}
