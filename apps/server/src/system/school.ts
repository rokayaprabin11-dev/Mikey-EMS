import { schoolProfileSchema } from '@mikey/shared'
import type { FastifyInstance } from 'fastify'

import type { AppDeps } from '../deps.ts'
import { registerRoute } from '../http/route.ts'
import { readSetting } from '../settings.ts'

// The school's name for any allowed computer, as the sign-in screen shows it; its contact details
// only for someone signed in.
export function registerSchoolRoute(app: FastifyInstance, deps: AppDeps): void {
  registerRoute(app, deps, 'schoolProfile', async ({ session }) => {
    const profile = await readSetting(deps.db, 'school.profile', schoolProfileSchema)
    if (profile === null) {
      return { name: null, details: null }
    }
    const { name, address, phone, email, pan } = profile
    return { name, details: session === null ? null : { address, phone, email, pan } }
  })
}
