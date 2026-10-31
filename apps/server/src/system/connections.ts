import type { AllowedComputer as AllowedComputerRow, User } from '@mikey/db'
import type { AllowedComputer } from '@mikey/shared'
import type { FastifyInstance } from 'fastify'

import { writeAudit } from '../audit.ts'
import { MINUTE } from '../auth/sessions.ts'
import type { AppDeps, Db } from '../deps.ts'
import { errors } from '../errors.ts'
import { registerRoute } from '../http/route.ts'
import { isLoopback } from '../network.ts'
import { isAllowedComputer } from './allow-list.ts'

const PENDING_LIMIT = 10
const REPEAT_MINUTES = 1
const EXPIRY_HOURS = 24

function expiryCutoff(now: Date): Date {
  return new Date(now.getTime() - EXPIRY_HOURS * 60 * MINUTE)
}

function withinRepeatWindow(since: Date, now: Date): boolean {
  return now.getTime() - since.getTime() < REPEAT_MINUTES * MINUTE
}

// One lock for every change to connection requests and the allow list keeps the pending limit
// and the one-pending-request-per-IP rule exact.
async function lockConnectionList(tx: Db): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('connection_requests'))`
}

function toAllowedComputer(row: AllowedComputerRow & { allowedBy: User }): AllowedComputer {
  return {
    id: row.id,
    ip: row.ip,
    computerName: row.computerName,
    allowedAt: row.allowedAt.toISOString(),
    allowedBy: row.allowedBy.fullName,
  }
}

function allowIp(tx: Db, ip: string, computerName: string, userId: string, now: Date) {
  const allowed = { computerName, allowedById: userId, allowedAt: now, removedById: null, removedAt: null }
  return tx.allowedComputer.upsert({
    where: { ip },
    create: { ip, ...allowed },
    update: allowed,
    include: { allowedBy: true },
  })
}

export function registerConnectionRoutes(app: FastifyInstance, deps: AppDeps): void {
  registerRoute(app, deps, 'requestConnection', ({ ip, now, body }) =>
    deps.db.$transaction(async (tx) => {
      await lockConnectionList(tx)
      if (await isAllowedComputer(tx, ip)) {
        return { ip, status: 'allowed' as const }
      }
      await tx.connectionRequest.updateMany({
        where: { status: 'pending', lastSeenAt: { lt: expiryCutoff(now) } },
        data: { status: 'expired' },
      })

      const latest = await tx.connectionRequest.findFirst({ where: { ip }, orderBy: { requestedAt: 'desc' } })
      if (latest?.status === 'pending') {
        if (!withinRepeatWindow(latest.lastSeenAt, now)) {
          await tx.connectionRequest.update({
            where: { id: latest.id },
            data: { lastSeenAt: now, computerName: body.computerName },
          })
        }
        return { ip, status: 'pending' as const }
      }
      if (latest?.status === 'declined' && (!body.askAgain || withinRepeatWindow(latest.requestedAt, now))) {
        return { ip, status: 'declined' as const }
      }

      if ((await tx.connectionRequest.count({ where: { status: 'pending' } })) >= PENDING_LIMIT) {
        throw errors.connectionRequestsFull()
      }
      await tx.connectionRequest.create({
        data: { ip, computerName: body.computerName, requestedAt: now, lastSeenAt: now },
      })
      return { ip, status: 'pending' as const }
    }),
  )

  registerRoute(app, deps, 'listConnections', async ({ now }) => {
    const [pending, allowed] = await Promise.all([
      deps.db.connectionRequest.findMany({
        where: { status: 'pending', lastSeenAt: { gte: expiryCutoff(now) } },
        orderBy: { requestedAt: 'asc' },
      }),
      deps.db.allowedComputer.findMany({
        where: { removedAt: null },
        include: { allowedBy: true },
        orderBy: { allowedAt: 'asc' },
      }),
    ])
    return {
      pending: pending.map((request) => ({
        id: request.id,
        ip: request.ip,
        computerName: request.computerName,
        requestedAt: request.requestedAt.toISOString(),
        lastSeenAt: request.lastSeenAt.toISOString(),
      })),
      allowed: allowed.map(toAllowedComputer),
    }
  })

  registerRoute(app, deps, 'allowConnection', ({ params, session, now, computer }) =>
    deps.db.$transaction(async (tx) => {
      await lockConnectionList(tx)
      const request = await tx.connectionRequest.findUnique({ where: { id: params.requestId } })
      if (request === null) {
        throw errors.notFound('This request')
      }
      if (request.status !== 'pending' || request.lastSeenAt < expiryCutoff(now)) {
        throw errors.requestNotPending()
      }
      await tx.connectionRequest.update({
        where: { id: request.id },
        data: { status: 'allowed', decidedById: session.user.id, decidedAt: now },
      })
      const allowed = await allowIp(tx, request.ip, request.computerName, session.user.id, now)
      await writeAudit(tx, {
        at: now,
        userId: session.user.id,
        computer,
        action: 'network.computer_allowed',
        area: 'Settings',
        recordType: 'allowed_computer',
        recordId: allowed.id,
        summary: `${session.user.fullName} allowed ${request.computerName} (${request.ip}) to connect`,
        after: { ip: request.ip, computerName: request.computerName },
      })
      return toAllowedComputer(allowed)
    }),
  )

  registerRoute(app, deps, 'declineConnection', ({ params, session, now, computer }) =>
    deps.db.$transaction(async (tx) => {
      await lockConnectionList(tx)
      const request = await tx.connectionRequest.findUnique({ where: { id: params.requestId } })
      if (request === null) {
        throw errors.notFound('This request')
      }
      if (request.status !== 'pending' || request.lastSeenAt < expiryCutoff(now)) {
        throw errors.requestNotPending()
      }
      await tx.connectionRequest.update({
        where: { id: request.id },
        data: { status: 'declined', decidedById: session.user.id, decidedAt: now },
      })
      await writeAudit(tx, {
        at: now,
        userId: session.user.id,
        computer,
        action: 'network.request_declined',
        area: 'Settings',
        recordType: 'connection_request',
        recordId: request.id,
        summary: `${session.user.fullName} declined ${request.computerName} (${request.ip})`,
      })
    }),
  )

  registerRoute(app, deps, 'addAllowedComputer', ({ body, session, now, computer }) => {
    if (isLoopback(body.ip)) {
      throw errors.alwaysAllowed()
    }
    return deps.db.$transaction(async (tx) => {
      await lockConnectionList(tx)
      const existing = await tx.allowedComputer.findUnique({ where: { ip: body.ip } })
      if (existing !== null && existing.removedAt === null) {
        throw errors.alreadyAllowed()
      }
      const allowed = await allowIp(tx, body.ip, body.computerName, session.user.id, now)
      await tx.connectionRequest.updateMany({
        where: { ip: body.ip, status: 'pending' },
        data: { status: 'allowed', decidedById: session.user.id, decidedAt: now },
      })
      await writeAudit(tx, {
        at: now,
        userId: session.user.id,
        computer,
        action: 'network.computer_allowed',
        area: 'Settings',
        recordType: 'allowed_computer',
        recordId: allowed.id,
        summary: `${session.user.fullName} added ${body.computerName} (${body.ip}) by IP address`,
        after: { ip: body.ip, computerName: body.computerName },
      })
      return toAllowedComputer(allowed)
    })
  })

  registerRoute(app, deps, 'removeAllowedComputer', ({ params, session, now, computer }) =>
    deps.db.$transaction(async (tx) => {
      await lockConnectionList(tx)
      const existing = await tx.allowedComputer.findUnique({ where: { id: params.computerId } })
      if (existing === null) {
        throw errors.notFound('This computer')
      }
      if (existing.removedAt !== null) {
        throw errors.alreadyRemoved()
      }
      await tx.allowedComputer.update({
        where: { id: existing.id },
        data: { removedById: session.user.id, removedAt: now },
      })
      await writeAudit(tx, {
        at: now,
        userId: session.user.id,
        computer,
        action: 'network.computer_removed',
        area: 'Settings',
        recordType: 'allowed_computer',
        recordId: existing.id,
        summary: `${session.user.fullName} removed ${existing.computerName} (${existing.ip}) from the allowed computers`,
        before: { ip: existing.ip, computerName: existing.computerName },
      })
    }),
  )
}
