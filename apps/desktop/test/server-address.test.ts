import { describe, expect, it } from 'vitest'

import { serverUrlFrom } from '../electron/server-address.ts'

describe('the server address typed on "Find Computer 1"', () => {
  it.each([
    ['192.168.1.10', 'http://192.168.1.10:3100'],
    ['  192.168.1.10  ', 'http://192.168.1.10:3100'],
    ['192.168.1.10:3199', 'http://192.168.1.10:3199'],
    ['http://192.168.1.10:3100', 'http://192.168.1.10:3100'],
    ['http://192.168.1.10:3100/', 'http://192.168.1.10:3100'],
    ['http://192.168.1.10', 'http://192.168.1.10:3100'],
    ['192.168.1.10:80', 'http://192.168.1.10'],
    ['MIKEY-SERVER', 'http://mikey-server:3100'],
    ['localhost', 'http://localhost:3100'],
  ])('reads %j as %s', (typed, saved) => {
    expect(serverUrlFrom(typed)).toBe(saved)
  })

  it.each(['', '   ', 'https://192.168.1.10', 'ftp://192.168.1.10', '192.168.1.10/api/v1', '192.168.1.10?x=1', 'user@192.168.1.10', 'two words'])(
    'is not an address: %j',
    (typed) => {
      expect(serverUrlFrom(typed)).toBeNull()
    },
  )

  it('gives back what it saved unchanged, which is how saved settings are checked', () => {
    const saved = serverUrlFrom('192.168.1.10')
    expect(saved).not.toBeNull()
    expect(serverUrlFrom(saved ?? '')).toBe(saved)
  })
})
