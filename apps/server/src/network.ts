import type { NetworkInterfaceInfo } from 'node:os'

const IPV4_IN_IPV6 = '::ffff:'

export function normalizeIp(ip: string): string {
  return ip.startsWith(IPV4_IN_IPV6) ? ip.slice(IPV4_IN_IPV6.length) : ip
}

export function isLoopback(ip: string): boolean {
  return ip === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)
}

function ipv4ToNumber(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) {
    return null
  }
  let value = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part) || Number(part) > 255) {
      return null
    }
    value = value * 256 + Number(part)
  }
  return value
}

function networkOf(address: number, mask: number): number {
  return (address & mask) >>> 0
}

export function isOnLocalNetwork(ip: string, interfaces: readonly NetworkInterfaceInfo[]): boolean {
  if (isLoopback(ip)) {
    return true
  }
  const address = ipv4ToNumber(ip)
  if (address === null) {
    return false
  }
  return interfaces.some((item) => {
    if (item.family !== 'IPv4' || item.internal) {
      return false
    }
    const own = ipv4ToNumber(item.address)
    const mask = ipv4ToNumber(item.netmask)
    return own !== null && mask !== null && networkOf(address, mask) === networkOf(own, mask)
  })
}
