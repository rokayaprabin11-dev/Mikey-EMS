// Computer 1's server listens on this port unless its installer was told otherwise
// (docs/ARCHITECTURE.md, Topology).
const DEFAULT_PORT = 3100

// One part of a computer name such as MIKEY-SERVER.
const NAME_PART = /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/

// An IPv4 address written plainly (no leading zeros), or a computer name.
function isHost(host: string): boolean {
  if (/^\d+(?:\.\d+){3}$/.test(host)) {
    return host.split('.').every((part) => String(Number(part)) === part && Number(part) <= 255)
  }
  return host.length <= 253 && !/^[\d.]+$/.test(host) && host.split('.').every((part) => NAME_PART.test(part))
}

// The server address as it is saved, `http://<host>:<port>`, from what was typed on the "Find
// Computer 1" step: `192.168.1.10`, `192.168.1.10:3100` or `http://192.168.1.10:3100`. Null when it
// is not an address. The office network has no certificates, so it is always plain http. It is
// read here rather than with URL because the renderer's and Node's URL readers accept different
// things, and both sides must agree.
export function serverUrlFrom(typed: string): string | null {
  const match = /^(?:http:\/\/)?([^/:?#@\s]+)(?::(\d{1,5}))?\/?$/i.exec(typed.trim())
  if (match === null) {
    return null
  }
  const host = (match[1] ?? '').toLowerCase()
  const port = match[2] === undefined ? DEFAULT_PORT : Number(match[2])
  return isHost(host) && port >= 1 && port <= 65_535 ? `http://${host}:${port}` : null
}

// A saved address as the screens show it: `192.168.1.10`, with the port only when it is not 3100.
export function addressOf(serverUrl: string): string {
  const [host = serverUrl, port] = serverUrl.replace(/^http:\/\//, '').split(':')
  return port === String(DEFAULT_PORT) ? host : `${host}:${port ?? ''}`
}
