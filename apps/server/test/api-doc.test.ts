import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { API_DOC, buildApiDoc } from '../scripts/api-doc.ts'

describe('docs/API.md', () => {
  it('says what the code says (run pnpm api:doc after changing an endpoint or the errors a route can return)', () => {
    expect(readFileSync(API_DOC, 'utf8')).toBe(buildApiDoc())
  }, 60_000)
})
