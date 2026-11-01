import { copyTestDatabase } from '@mikey/db/testing'
import { inject } from 'vitest'

import { useTestDatabase } from './support.ts'

// Every test file works in a fresh copy of the migrated test database (setup-test-database.ts
// makes it once per run). Files set their clocks on different days, and in a shared database the
// money one file dates on its day would change the cashbook balances another file checks.
useTestDatabase(await copyTestDatabase(inject('testDatabaseUrl'), 'mikeyems_test_file'))
