import type { LoginRequest, LoginResponse, PermissionKey } from '@mikey/shared'

import { type AuditEntry, writeAudit } from '../audit.ts'
import type { AppDeps } from '../deps.ts'
import { errors } from '../errors.ts'
import { checkPassword } from './passwords.ts'
import { IDLE_MINUTES, MINUTE, newSessionToken, permissionsOf, type RequestContext, SESSION_HOURS } from './sessions.ts'

const LOCK_AFTER_WRONG_PASSWORDS = 5
const WRONG_PASSWORD_WINDOW_MINUTES = 10
const LOCK_MINUTES = 10
const SIGN_IN_FAILED = 'auth.sign_in_failed'

type Outcome =
  | { result: 'signed_in'; token: string; permissions: PermissionKey[] }
  | { result: 'locked'; until: Date }
  | { result: 'wrong_password' }
  | { result: 'inactive' }

function latest(...moments: (Date | null)[]): Date {
  return new Date(Math.max(...moments.map((moment) => moment?.getTime() ?? 0)))
}

export async function signIn(deps: AppDeps, request: LoginRequest, context: RequestContext): Promise<LoginResponse> {
  const { db } = deps
  const { now, computer } = context
  const user = await db.user.findUnique({ where: { username: request.username }, include: { role: true } })
  const passwordOk = await checkPassword(user?.passwordHash ?? null, request.password)

  // The typed text is never stored: it may be a password typed into the wrong box.
  if (user === null) {
    await writeAudit(db, {
      at: now,
      userId: null,
      computer,
      action: SIGN_IN_FAILED,
      area: 'Sign-in',
      summary: `Sign-in with unknown username on Computer ${computer} (${context.ip})`,
    })
    throw errors.wrongCredentials()
  }

  const audit = (action: string, summary: string): AuditEntry => ({
    at: now,
    userId: user.id,
    computer,
    action,
    area: 'Sign-in',
    recordType: 'user',
    recordId: user.id,
    summary,
  })

  // Failures are returned, not thrown, so their audit rows are committed.
  const outcome = await db.$transaction(async (tx): Promise<Outcome> => {
    // Locking the user row makes two wrong passwords sent at the same moment count as two.
    const [current] = await tx.$queryRaw<{ last_login_at: Date | null; locked_until: Date | null }[]>`
      SELECT last_login_at, locked_until FROM users WHERE id = ${user.id}::uuid FOR UPDATE`
    if (current === undefined) {
      throw new Error(`User ${user.id} was not found while signing in.`)
    }

    if (current.locked_until !== null && current.locked_until > now) {
      await writeAudit(tx, audit('auth.sign_in_refused', `Sign-in refused for ${user.username}: locked after wrong passwords`))
      return { result: 'locked', until: current.locked_until }
    }

    if (!passwordOk) {
      await writeAudit(tx, audit(SIGN_IN_FAILED, `Wrong password for ${user.username}`))
      const windowStart = latest(
        new Date(now.getTime() - WRONG_PASSWORD_WINDOW_MINUTES * MINUTE),
        current.last_login_at,
        current.locked_until,
      )
      const failures = await tx.auditLog.count({
        where: { userId: user.id, action: SIGN_IN_FAILED, at: { gt: windowStart, lte: now } },
      })
      if (failures < LOCK_AFTER_WRONG_PASSWORDS) {
        return { result: 'wrong_password' }
      }
      const until = new Date(now.getTime() + LOCK_MINUTES * MINUTE)
      await tx.user.update({ where: { id: user.id }, data: { lockedUntil: until } })
      await writeAudit(
        tx,
        audit('auth.locked', `${user.username} was locked for ${LOCK_MINUTES} minutes after ${failures} wrong passwords`),
      )
      return { result: 'locked', until }
    }

    if (user.status !== 'active') {
      await writeAudit(tx, audit('auth.sign_in_refused', `Sign-in refused for ${user.username}: the account is switched off`))
      return { result: 'inactive' }
    }

    const { token, tokenHash } = newSessionToken()
    await tx.session.create({
      data: {
        userId: user.id,
        tokenHash,
        computer,
        lastSeenAt: now,
        expiresAt: new Date(now.getTime() + SESSION_HOURS * 60 * MINUTE),
      },
    })
    await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: now, lockedUntil: null } })
    await writeAudit(tx, audit('auth.signed_in', `${user.fullName} signed in on Computer ${computer}`))
    return { result: 'signed_in', token, permissions: await permissionsOf(tx, user.roleId) }
  })

  if (outcome.result === 'locked') {
    throw errors.accountLocked(Math.ceil((outcome.until.getTime() - now.getTime()) / MINUTE))
  }
  if (outcome.result === 'wrong_password') {
    throw errors.wrongCredentials()
  }
  if (outcome.result === 'inactive') {
    throw errors.accountInactive()
  }
  return {
    token: outcome.token,
    idleTimeoutMinutes: IDLE_MINUTES,
    user: {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      role: user.role.name,
      permissions: outcome.permissions,
    },
  }
}
