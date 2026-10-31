import { describe, expect, it } from 'vitest'

import { readConfig } from './config.ts'

const env = { API_HOST: '127.0.0.1', API_PORT: '3100' }

describe('readConfig', () => {
  it('reads the host and port', () => {
    expect(readConfig(env, 'Asia/Kathmandu')).toEqual({ host: '127.0.0.1', port: 3100 })
  })

  it('accepts the older spelling Asia/Katmandu that ICU reports for TZ=Asia/Kathmandu', () => {
    expect(readConfig(env, 'Asia/Katmandu')).toEqual({ host: '127.0.0.1', port: 3100 })
  })

  it('refuses to start outside the Asia/Kathmandu time zone', () => {
    expect(() => readConfig(env, 'UTC')).toThrow('TZ=Asia/Kathmandu')
  })

  it('needs API_HOST', () => {
    expect(() => readConfig({ API_PORT: '3100' }, 'Asia/Kathmandu')).toThrow('API_HOST')
  })

  it.each([undefined, '', 'abc', '0', '65536', '3100.5'])('rejects API_PORT %j', (port) => {
    expect(() => readConfig({ API_HOST: '127.0.0.1', API_PORT: port }, 'Asia/Kathmandu')).toThrow('API_PORT')
  })
})
