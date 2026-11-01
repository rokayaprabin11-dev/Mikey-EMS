// Computer 1's server listens on this port unless its installer was told otherwise
// (docs/ARCHITECTURE.md, Topology).
const DEFAULT_PORT = 3100

// The server address as it is saved, `http://<host>:<port>`, from what was typed on the "Find
// Computer 1" step: `192.168.1.10`, `192.168.1.10:3100` or `http://192.168.1.10:3100`. Null when it
// is not an address. The office network has no certificates, so it is always plain http.
export function serverUrlFrom(typed: string): string | null {
  const text = typed.trim()
  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(text) ? text : `http://${text}`
  if (text === '' || !URL.canParse(withScheme)) {
    return null
  }
  const url = new URL(withScheme)
  const onlyAnAddress =
    url.protocol === 'http:' &&
    url.hostname !== '' &&
    url.username === '' &&
    url.password === '' &&
    url.pathname === '/' &&
    url.search === '' &&
    url.hash === ''
  if (!onlyAnAddress) {
    return null
  }
  // URL drops a typed :80, so look at the text to see whether a port was given.
  if (!/:\d+\/?$/.test(withScheme)) {
    url.port = String(DEFAULT_PORT)
  }
  return url.origin
}
