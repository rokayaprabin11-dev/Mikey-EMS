import { schoolProfileSchema } from '@mikey/shared'
import type { FastifyInstance } from 'fastify'

import type { AppDeps } from '../deps.ts'
import { registerRoute } from '../http/route.ts'
import { readSetting } from '../settings.ts'
import { isAllowedComputer } from './allow-list.ts'

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
      deps.db.device.findMany({ where: { status: 'active' }, select: { lastSyncAt: true, lastSuccessAt: true } }),
      readSetting(deps.db, 'school.profile', schoolProfileSchema),
    ])
    return {
      server: 'ok',
      db: 'ok',
      device: deviceStatus(devices),
      // Cloud backup is set up on Computer 1 by a later build; until then nothing is set up.
      cloudBackup: 'not_set_up',
      allowed,
      time,
      serverName,
      schoolName: profile?.name ?? null,
    }
  })
}
