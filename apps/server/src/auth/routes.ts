import type { FastifyInstance } from 'fastify'

import { writeAudit } from '../audit.ts'
import type { AppDeps } from '../deps.ts'
import { registerRoute } from '../http/route.ts'
import { IDLE_MINUTES } from './sessions.ts'
import { signIn } from './sign-in.ts'

export function registerAuthRoutes(app: FastifyInstance, deps: AppDeps): void {
  registerRoute(app, deps, 'login', (input) => signIn(deps, input.body, input))

  registerRoute(app, deps, 'session', ({ session }) =>
    Promise.resolve({ user: session.user, idleTimeoutMinutes: IDLE_MINUTES }),
  )

  registerRoute(app, deps, 'logout', async ({ session, now, computer }) => {
    await deps.db.$transaction(async (tx) => {
      await tx.session.delete({ where: { id: session.sessionId } })
      await writeAudit(tx, {
        at: now,
        userId: session.user.id,
        computer,
        action: 'auth.signed_out',
        area: 'Sign-in',
        recordType: 'user',
        recordId: session.user.id,
        summary: `${session.user.fullName} signed out`,
      })
    })
  })
}
