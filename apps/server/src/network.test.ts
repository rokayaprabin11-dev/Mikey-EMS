import type { NetworkInterfaceInfo } from 'node:os'

import { describe, expect, it } from 'vitest'

import { isLoopback, isOnLocalNetwork, normalizeIp } from './network.ts'

const office: NetworkInterfaceInfo[] = [
  { address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal: true, cidr: '127.0.0.1/8' },
  { address: '192.168.1.10', netmask: '255.255.255.0', family: 'IPv4', mac: 'aa:bb:cc:dd:ee:ff', internal: false, cidr: '192.168.1.10/24' },
]

describe('normalizeIp', () => {
  it('turns an IPv4 address written inside IPv6 back into IPv4', () => {
    expect(normalizeIp('::ffff:192.168.1.11')).toBe('192.168.1.11')
    expect(normalizeIp('192.168.1.11')).toBe('192.168.1.11')
    expect(normalizeIp('::1')).toBe('::1')
  })
})

describe('isLoopback', () => {
  it.each([
    ['127.0.0.1', true],
    ['127.1.2.3', true],
    ['::1', true],
    ['192.168.1.10', false],
    ['1127.0.0.1', false],
  ])('%s is this computer: %s', (ip, expected) => {
    expect(isLoopback(ip)).toBe(expected)
  })
})

describe('isOnLocalNetwork', () => {
  it.each([
    ['192.168.1.11', true],
    ['192.168.1.254', true],
    ['127.0.0.1', true],
    ['192.168.2.11', false],
    ['10.9.8.7', false],
    ['fe80::1', false],
    ['192.168.1', false],
    ['192.168.1.300', false],
  ])('%s is on the office network: %s', (ip, expected) => {
    expect(isOnLocalNetwork(ip, office)).toBe(expected)
  })

  it('does not treat the loopback adapter as the office network', () => {
    expect(isOnLocalNetwork('127.5.5.5', [])).toBe(true)
    expect(isOnLocalNetwork('192.168.1.11', [])).toBe(false)
  })
})
