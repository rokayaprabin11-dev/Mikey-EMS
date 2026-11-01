import { randomUUID } from 'node:crypto'

import type { User } from '@mikey/db'
import { ACCOUNTANT_DEFAULT_PERMISSIONS, API_PREFIX, type EndpointName, endpoints, PERMISSION_KEYS } from '@mikey/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildApp } from '../src/app.ts'
import { allowComputer, createUser, ensureSchool, errorOf, signIn, startTestServer, type TestServer } from './support.ts'

// The Accountant works on Computer 2.
const COUNTER = '192.168.1.87'

const server: TestServer = startTestServer()
let admin: User
let accountant: User

beforeAll(async () => {
  await ensureSchool(server.db)
  admin = await createUser(server.db, 'super_admin')
  accountant = await createUser(server.db, 'accountant')
  await allowComputer(server.db, COUNTER, admin)
})

afterAll(() => server.close())

// Every route Fastify has, read from its route tree. Each line of the tree adds its part of the
// path to the parts above it; HEAD routes are Fastify's own copies of the GET ones.
function registeredRoutes(): { method: string; path: string }[] {
  const app = buildApp(
    { db: server.db, clock: () => new Date(), hostname: () => 'TEST', networkInterfaces: () => [] },
    { logger: false },
  )
  const routes: { method: string; path: string }[] = []
  const parents: string[] = []
  for (const line of app.printRoutes({ commonPrefix: false }).split('\n')) {
    if (line.trim() === '') {
      continue
    }
    const match = /^((?:│ {3}| {4})*)[├└]── (\S+)(?: \(([A-Z, ]+)\))?$/.exec(line)
    if (match === null) {
      throw new Error(`Cannot read the route line "${line}".`)
    }
    const [, indent = '', part = '', methods = ''] = match
    parents.length = indent.length / 4
    const path = parents.join('') + part
    parents.push(part)
    for (const method of methods.split(', ').filter((name) => name !== '' && name !== 'HEAD')) {
      routes.push({ method, path })
    }
  }
  return routes
}

// The endpoints open before sign-in, and those any signed-in user may call. Every other route
// needs a permission key.
const WITHOUT_A_PERMISSION: Partial<Record<EndpointName, string>> = {
  health: 'anyone may ask whether Computer 1 is there',
  requestConnection: 'a computer on the office network asks to be allowed',
  login: 'signing in is how a session starts, from an allowed computer',
  session: 'anyone signed in may read their own session',
  logout: 'anyone signed in may sign out',
  schoolProfile: 'every screen shows the school',
  classes: 'the class filters on several screens',
}

describe('every route', () => {
  const routes = registeredRoutes()
  const byRoute = new Map(Object.entries(endpoints).map(([name, endpoint]) => [`${endpoint.method} ${API_PREFIX}${endpoint.path}`, name as EndpointName]))

  it('is listed and is in the contract', () => {
    expect(routes.length).toBeGreaterThan(40)
    for (const route of routes) {
      expect(byRoute.get(`${route.method} ${route.path}`), `${route.method} ${route.path}`).toBeDefined()
    }
  })

  it('declares a permission, unless it is one of the few that need none', () => {
    for (const route of routes) {
      const name = byRoute.get(`${route.method} ${route.path}`)
      if (name === undefined) {
        continue
      }
      const { access } = endpoints[name]
      const hasPermission = (PERMISSION_KEYS as readonly string[]).includes(access)
      expect(hasPermission || WITHOUT_A_PERMISSION[name] !== undefined, `${name} (${access}) declares no permission`).toBe(true)
    }
  })
})

// Each route the Accountant's role does not have the permission for, with its path filled in.
const forbidden = Object.entries(endpoints)
  .filter(([, endpoint]) => (PERMISSION_KEYS as readonly string[]).includes(endpoint.access))
  .filter(([, endpoint]) => !(ACCOUNTANT_DEFAULT_PERMISSIONS as readonly string[]).includes(endpoint.access))
  .map(([name, endpoint]) => ({ name, method: endpoint.method, path: endpoint.path.replace(/:date/g, '2026-10-31').replace(/:[a-zA-Z]+/g, randomUUID()) }))

describe('the Accountant', () => {
  it('is refused the Super Admin routes, which are these', () => {
    expect(forbidden.map((route) => route.name).sort()).toEqual(
      [
        'addAllowedComputer',
        'allowConnection',
        'allowOriginalPrint',
        'approveVoid',
        'declineConnection',
        'declineVoid',
        'listConnections',
        'listPendingVoidRequests',
        'removeAllowedComputer',
        'schoolDashboard',
        'voidDirectly',
      ].sort(),
    )
  })

  it.each(forbidden)('gets 403 from $name', async ({ method, path }) => {
    const token = await signIn(server, accountant, COUNTER)
    const response = await server.call({ method, path, token, ip: COUNTER, ...(method === 'POST' ? { body: {} } : {}) })
    expect(errorOf(response)).toMatchObject({ status: 403, code: 'NO_PERMISSION' })
  })
})
