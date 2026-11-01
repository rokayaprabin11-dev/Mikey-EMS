import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globalSetup: ['./test/setup-test-database.ts'],
    setupFiles: ['./test/own-database.ts', './test/no-overlapping-queries.ts'],
    // Each test file works in its own copy of the test database, made under one name, so the
    // files run one at a time.
    fileParallelism: false,
  },
})
