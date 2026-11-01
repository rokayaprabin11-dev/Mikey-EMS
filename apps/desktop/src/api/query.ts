import { QueryClient } from '@tanstack/react-query'

// The cache for Computer 1's data, and nothing else (AGENTS.md). A failed request is not tried
// again behind the screen's back: the screen shows what happened, and the connection check
// decides when Computer 1 is back.
export function newQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  })
}
