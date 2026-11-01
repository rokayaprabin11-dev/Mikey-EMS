import { describe, expect, it } from 'vitest'

import { addressOf, serverUrlFrom } from '../electron/server-address.ts'

describe('the server address typed on "Find Computer 1"', () => {
  it.each([
    ['192.168.1.10', 'http://192.168.1.10:3100'],
    ['  192.168.1.10  ', 'http://192.168.1.10:3100'],
    ['192.168.1.10:3199', 'http://192.168.1.10:3199'],
    ['http://192.168.1.10:3100', 'http://192.168.1.10:3100'],
    ['HTTP://192.168.1.10:3100/', 'http://192.168.1.10:3100'],
    ['http://192.168.1.10', 'http://192.168.1.10:3100'],
    ['192.168.1.10:80', 'http://192.168.1.10:80'],
    ['MIKEY-SERVER', 'http://mikey-server:3100'],
    ['mikey-server.local', 'http://mikey-server.local:3100'],
    ['localhost', 'http://localhost:3100'],
  ])('reads %j as %s', (typed, saved) => {
    expect(serverUrlFrom(typed)).toBe(saved)
  })

  it.each([
    '',
    '   ',
    'not an address',
    'https://192.168.1.10',
    'ftp://192.168.1.10',
    '192.168.1.10/api/v1',
    '192.168.1.10?x=1',
    'user@192.168.1.10',
    '256.1.1.1',
    '192.168.001.010',
    '192.168.1',
    '1234',
    '192.168.1.10:0',
    '192.168.1.10:65536',
    '-mikey',
    '[::1]:3100',
  ])('is not an address: %j', (typed) => {
    expect(serverUrlFrom(typed)).toBeNull()
  })

  it('gives back what it saved unchanged, which is how saved settings are checked', () => {
    const saved = serverUrlFrom('192.168.1.10')
    expect(saved).not.toBeNull()
    expect(serverUrlFrom(saved ?? '')).toBe(saved)
  })

  it('shows a saved address as it was typed, with the port only when it is not the usual one', () => {
    expect(addressOf('http://192.168.1.10:3100')).toBe('192.168.1.10')
    expect(addressOf('http://192.168.1.10:3199')).toBe('192.168.1.10:3199')
    expect(addressOf('http://mikey-server:3100')).toBe('mikey-server')
    for (const typed of ['192.168.1.10', '192.168.1.10:3199', 'MIKEY-SERVER']) {
      expect(serverUrlFrom(addressOf(serverUrlFrom(typed) ?? ''))).toBe(serverUrlFrom(typed))
    }
  })
})
