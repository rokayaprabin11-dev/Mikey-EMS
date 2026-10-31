import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ERRORS } from '@mikey/shared'
import { describe, expect, it } from 'vitest'

const sourceDir = fileURLToPath(new URL('.', import.meta.url))
const sources = readdirSync(sourceDir, { recursive: true, encoding: 'utf8' })
  .filter((path) => path.endsWith('.ts') && !path.endsWith('.test.ts'))
  .map((path) => ({ path, text: readFileSync(join(sourceDir, path), 'utf8') }))

describe('error replies', () => {
  it('only ever use codes from the shared list', () => {
    const used = sources.flatMap(({ text }) =>
      [...text.matchAll(/fail\('([A-Z_]+)'/g)].flatMap((match) => (match[1] === undefined ? [] : [match[1]])),
    )
    expect(used.length).toBeGreaterThan(20)
    expect(used.filter((code) => !Object.hasOwn(ERRORS, code))).toEqual([])
  })

  it('are all built by fail(), which reads the shared list', () => {
    const elsewhere = sources.filter(({ path, text }) => path !== 'errors.ts' && text.includes('new AppError('))
    expect(elsewhere.map(({ path }) => path)).toEqual([])
  })
})
