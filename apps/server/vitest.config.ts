import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globalSetup: ['./test/setup-test-database.ts'],
    setupFiles: ['./test/no-overlapping-queries.ts'],
    // The test files share one database (the school profile, accounts, receipt counters), so
    // they run one at a time.
    fileParallelism: false,
  },
})
