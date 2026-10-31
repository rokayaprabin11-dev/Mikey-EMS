import { describe, expect, it } from 'vitest'

import { readConfig } from './config.ts'

const env = { API_HOST: '127.0.0.1', API_PORT: '3100', DATABASE_URL: 'postgresql://mikey:mikey@127.0.0.1:5432/mikeyems' }
const expected = { host: '127.0.0.1', port: 3100, databaseUrl: env.DATABASE_URL }

describe('readConfig', () => {
  it('reads the host, port and database address', () => {
    expect(readConfig(env, 'Asia/Kathmandu')).toEqual(expected)
  })

  it('accepts the older spelling Asia/Katmandu that ICU reports for TZ=Asia/Kathmandu', () => {
    expect(readConfig(env, 'Asia/Katmandu')).toEqual(expected)
  })

  it('refuses to start outside the Asia/Kathmandu time zone', () => {
    expect(() => readConfig(env, 'UTC')).toThrow('TZ=Asia/Kathmandu')
  })

  it('needs API_HOST', () => {
    expect(() => readConfig({ ...env, API_HOST: undefined }, 'Asia/Kathmandu')).toThrow('API_HOST')
  })

  it.each([undefined, '', 'abc', '0', '65536', '3100.5'])('rejects API_PORT %j', (port) => {
    expect(() => readConfig({ ...env, API_PORT: port }, 'Asia/Kathmandu')).toThrow('API_PORT')
  })

  it('needs DATABASE_URL', () => {
    expect(() => readConfig({ ...env, DATABASE_URL: undefined }, 'Asia/Kathmandu')).toThrow('DATABASE_URL')
  })

  it.each([
    'postgresql://mikey:mikey@localhost:5432/mikeyems',
    'postgresql://mikey:mikey@192.168.1.10:5432/mikeyems',
    'not a url',
  ])('refuses a DATABASE_URL that does not point at 127.0.0.1: %s', (url) => {
    expect(() => readConfig({ ...env, DATABASE_URL: url }, 'Asia/Kathmandu')).toThrow('127.0.0.1')
  })
})
