import type { HealthResponse } from '@mikey/shared'
import { useQuery } from '@tanstack/react-query'

import { api } from './api/client.ts'

// ARCHITECTURE.md, Health and connection status: asked every 5 seconds, with no session.
const POLL_MS = 5_000
const TIMEOUT_MS = 4_000

export interface HealthCheck {
  health: HealthResponse
  // How long Computer 1 took to answer.
  tookMs: number
}

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: async (): Promise<HealthCheck> => {
      const started = performance.now()
      const health = await api.call('health', { timeoutMs: TIMEOUT_MS })
      return { health, tookMs: Math.round(performance.now() - started) }
    },
    refetchInterval: POLL_MS,
  })
}
