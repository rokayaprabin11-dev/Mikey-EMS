import { createHash, randomBytes } from 'node:crypto'

import { type CurrentUser, PERMISSION_KEYS, type PermissionKey } from '@mikey/shared'

import { writeAudit } from '../audit.ts'
import type { AppDeps, Db } from '../deps.ts'
import { type AppError, fail } from '../errors.ts'

export const IDLE_MINUTES = 15
export const SESSION_HOURS = 12
export const MINUTE = 60_000

export interface RequestContext {
  ip: string
  computer: 1 | 2
  now: Date
}

export interface SessionContext {
  sessionId: string
  user: CurrentUser
  permissions: ReadonlySet<PermissionKey>
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function newSessionToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, tokenHash: hashToken(token) }
}

const knownKeys = new Set<string>(PERMISSION_KEYS)

function isPermissionKey(key: string): key is PermissionKey {
  return knownKeys.has(key)
}

export async function permissionsOf(db: Db, roleId: string): Promise<PermissionKey[]> {
  const rows = await db.rolePermission.findMany({ where: { roleId }, select: { permissionKey: true } })
  return rows.map((row) => row.permissionKey).filter(isPermissionKey)
}

interface Ending {
  reason: string
  error: AppError
}

function endingOf(
  session: { lastSeenAt: Date; expiresAt: Date; user: { status: string } },
  now: Date,
): Ending | null {
  if (session.user.status !== 'active') {
    return { reason: 'because the account was switched off', error: fail('NOT_SIGNED_IN') }
  }
  if (now >= session.expiresAt) {
    return { reason: `after ${SESSION_HOURS} hours`, error: fail('SESSION_EXPIRED', { hours: SESSION_HOURS }) }
  }
  if (now.getTime() - session.lastSeenAt.getTime() >= IDLE_MINUTES * MINUTE) {
    return { reason: `after ${IDLE_MINUTES} minutes without activity`, error: fail('SESSION_EXPIRED', { idleMinutes: IDLE_MINUTES }) }
  }
  return null
}

export async function authenticate(
  deps: AppDeps,
  authorization: string | undefined,
  context: RequestContext,
): Promise<SessionContext> {
  const token = /^Bearer (\S+)$/.exec(authorization ?? '')?.[1]
  if (token === undefined) {
    throw fail('NOT_SIGNED_IN')
  }
  const session = await deps.db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { include: { role: true } } },
  })
  if (session === null) {
    throw fail('NOT_SIGNED_IN')
  }

  const { user } = session
  const ended = endingOf(session, context.now)
  if (ended !== null) {
    await deps.db.$transaction(async (tx) => {
      const { count } = await tx.session.deleteMany({ where: { id: session.id } })
      if (count === 1) {
        await writeAudit(tx, {
          at: context.now,
          userId: user.id,
          computer: context.computer,
          action: 'auth.session_ended',
          area: 'Sign-in',
          recordType: 'user',
          recordId: user.id,
          summary: `${user.fullName} was signed out ${ended.reason}`,
        })
      }
    })
    throw ended.error
  }

  await deps.db.session.update({ where: { id: session.id }, data: { lastSeenAt: context.now } })
  const permissions = await permissionsOf(deps.db, user.roleId)
  return {
    sessionId: session.id,
    user: { id: user.id, username: user.username, fullName: user.fullName, role: user.role.name, permissions },
    permissions: new Set(permissions),
  }
}
