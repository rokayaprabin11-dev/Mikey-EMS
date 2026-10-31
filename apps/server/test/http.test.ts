import { afterAll, describe, expect, it } from 'vitest'

import { errorOf, startTestServer, type TestServer } from './support.ts'

const server: TestServer = startTestServer()

afterAll(() => server.close())

describe('requests Computer 1 cannot use', () => {
  it('answers an address it does not know with NOT_FOUND in the usual error shape', async () => {
    const response = await server.call({ method: 'GET', path: '/no-such-thing' })
    expect(errorOf(response)).toMatchObject({ status: 404, code: 'NOT_FOUND' })
  })

  it('answers a body that is not JSON with BAD_REQUEST', async () => {
    const response = await server.call({
      method: 'POST',
      path: '/auth/login',
      headers: { 'content-type': 'application/json' },
      body: Buffer.from('{username'),
    })
    expect(errorOf(response)).toMatchObject({ status: 400, code: 'BAD_REQUEST' })
  })
})
