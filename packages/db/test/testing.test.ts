import { describe, expect, it } from 'vitest'

import { checkTestDatabaseUrl, copyTestDatabase, createFreshTestDatabase, dropTestDatabase } from '../src/testing.ts'

const server = 'postgresql://mikey:mikey@127.0.0.1:5432'

// The helpers check the name before they connect, so these never reach a database.
describe('test database helpers', () => {
  it('refuse to make, copy from, copy over or drop a database that is not a test database', async () => {
    await expect(createFreshTestDatabase('mikeyems' as `mikeyems_test${string}`)).rejects.toThrow('"mikeyems" is not a test database name.')
    await expect(copyTestDatabase(`${server}/mikeyems`, 'mikeyems_test_file')).rejects.toThrow('is not a test database name')
    await expect(copyTestDatabase(`${server}/mikeyems_test_server`, 'mikeyems' as `mikeyems_test${string}`)).rejects.toThrow(
      'is not a test database name',
    )
    await expect(dropTestDatabase(`${server}/mikeyems_test`, 'mikeyems' as `mikeyems_test${string}`)).rejects.toThrow(
      'is not a test database name',
    )
  })

  it('tell a test database address from any other', () => {
    expect(() => {
      checkTestDatabaseUrl(`${server}/mikeyems_test_file`)
    }).not.toThrow()
    for (const name of ['mikeyems', 'mikeyems_tests', 'mikeyems_test_2', 'postgres']) {
      expect(() => {
        checkTestDatabaseUrl(`${server}/${name}`)
      }, name).toThrow('is not a test database name')
    }
  })
})
