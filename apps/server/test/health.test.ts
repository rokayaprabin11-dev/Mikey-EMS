import type { User } from '@mikey/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { allowComputer, createUser, SERVER_NAME, startTestServer, type TestServer } from './support.ts'

const server: TestServer = startTestServer()
let admin: User

beforeAll(async () => {
  admin = await createUser(server.db, 'super_admin')
})

afterAll(() => server.close())

async function health(ip?: string): Promise<unknown> {
  const response = await server.call({ method: 'GET', path: '/health', ip })
  expect(response.statusCode).toBe(200)
  return response.json()
}

describe('health check', () => {
  it('reports the server, the database and Computer 1 itself, and the school once setup has saved it', async () => {
    await server.db.setting.deleteMany({ where: { key: 'school.profile' } })
    expect(await health()).toEqual({
      server: 'ok',
      db: 'ok',
      device: 'none',
      lastSyncAt: null,
      cloudBackup: 'not_set_up',
      allowed: true,
      time: server.now().toISOString(),
      serverName: SERVER_NAME,
      schoolName: null,
    })

    await server.db.setting.create({
      data: {
        key: 'school.profile',
        value: { name: 'Mikey English Medium School', address: null, phone: null, email: null, pan: null },
      },
    })
    expect(await health()).toMatchObject({ schoolName: 'Mikey English Medium School' })
  })

  it('tells a computer on the office network whether it is allowed', async () => {
    expect(await health('192.168.1.30')).toMatchObject({ allowed: false })

    await allowComputer(server.db, '192.168.1.30', admin)
    expect(await health('192.168.1.30')).toMatchObject({ allowed: true })

    await server.db.allowedComputer.update({
      where: { ip: '192.168.1.30' },
      data: { removedAt: server.now(), removedById: admin.id },
    })
    expect(await health('192.168.1.30')).toMatchObject({ allowed: false })
  })

  it('reports the fingerprint devices from their last pull, and when that was', async () => {
    await server.db.device.create({
      data: { name: 'Spreadsheet import', connection: 'file', lastSyncAt: new Date('2026-10-31T05:30:00.000Z') },
    })
    expect(await health()).toMatchObject({ device: 'none', lastSyncAt: null })

    const pulled = new Date('2026-10-31T04:55:00.000Z')
    await server.db.device.create({
      data: { name: 'Main gate', connection: 'lan', lastSyncAt: pulled, lastSuccessAt: pulled },
    })
    expect(await health()).toMatchObject({ device: 'connected', lastSyncAt: '2026-10-31T04:55:00.000Z' })

    const office = await server.db.device.create({
      data: { name: 'Office', connection: 'lan', lastSyncAt: new Date('2026-10-31T05:05:00.000Z'), lastSuccessAt: pulled },
    })
    expect(await health()).toMatchObject({ device: 'not_responding', lastSyncAt: '2026-10-31T05:05:00.000Z' })

    await server.db.device.update({ where: { id: office.id }, data: { status: 'disabled' } })
    expect(await health()).toMatchObject({ device: 'connected', lastSyncAt: '2026-10-31T04:55:00.000Z' })

    await server.db.device.create({ data: { name: 'Never pulled', connection: 'usb' } })
    expect(await health()).toMatchObject({ device: 'not_responding', lastSyncAt: '2026-10-31T04:55:00.000Z' })
  })

  it('says only that the database is down when Computer 1 cannot reach it', async () => {
    const broken = startTestServer('postgresql://mikey:mikey@127.0.0.1:1/mikeyems')
    try {
      const response = await broken.call({ method: 'GET', path: '/health', ip: '192.168.1.31' })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({
        server: 'ok',
        db: 'down',
        time: broken.now().toISOString(),
        serverName: SERVER_NAME,
      })
    } finally {
      await broken.close()
    }
  })
})
