import { API_PREFIX } from '@mikey/shared'
import { z } from 'zod'

import type { ServerReply, ServerRequest } from '../bridge.ts'

// Checked here because it comes from the renderer: only paths under /api/v1 on the saved server.
export const serverRequestSchema = z.object({
  method: z.enum(['GET', 'POST']),
  path: z.string().regex(/^\/[\w\-./%?=&:~]*$/),
  token: z.string().min(1).nullable(),
  body: z.string().nullable(),
  timeoutMs: z.int().min(1).max(120_000),
}) satisfies z.ZodType<ServerRequest>

// What went wrong when no reply came back, as Node says it, for "Copy error details".
function reasonOf(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error)
  }
  if (error.name === 'TimeoutError') {
    return 'No reply in time'
  }
  const cause = error.cause
  return cause instanceof Error ? `${error.message}: ${cause.message}` : error.message
}

// `serverUrl` is a saved or typed address (server-address.ts), so the path can only come after it.
export async function sendToServer(serverUrl: string, request: ServerRequest): Promise<ServerReply> {
  const url = `${serverUrl}${API_PREFIX}${request.path}`
  const headers: Record<string, string> = {}
  if (request.token !== null) {
    headers.authorization = `Bearer ${request.token}`
  }
  if (request.body !== null) {
    headers['content-type'] = 'application/json'
  }
  // fetch only fails when no reply came back: the address, the network, or the time allowed.
  try {
    const response = await fetch(url, {
      method: request.method,
      headers,
      body: request.body,
      signal: AbortSignal.timeout(request.timeoutMs),
    })
    const body = new Uint8Array(await response.arrayBuffer())
    return { reached: true, status: response.status, contentType: response.headers.get('content-type') ?? '', body }
  } catch (error) {
    return { reached: false, reason: reasonOf(error) }
  }
}
