import { describe, expect, it } from 'vitest'

import { startTestServer } from './support.ts'

describe('test servers', () => {
  it('only ever work in a test database, never in the developer database mikeyems', () => {
    expect(() => startTestServer('postgresql://mikey:mikey@127.0.0.1:5432/mikeyems')).toThrow('"mikeyems" is not a test database name.')
  })
})
