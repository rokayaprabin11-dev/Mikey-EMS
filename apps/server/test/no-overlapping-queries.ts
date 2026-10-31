import { afterAll, expect } from 'vitest'

// pg warns when a connection is given a query while it is still running another; pg 9 will refuse
// it. Inside a transaction Prisma does that for Promise.all and for relations loaded side by side,
// so any such warning fails the test file (CLAUDE.md).
const overlaps: string[] = []

process.on('warning', (warning) => {
  if (warning.message.includes('client is already executing a query')) {
    overlaps.push(warning.stack ?? warning.message)
  }
})

afterAll(() => {
  expect(overlaps).toEqual([])
})
