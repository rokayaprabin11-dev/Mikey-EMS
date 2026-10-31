import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  ACCOUNTANT_DEFAULT_PERMISSIONS,
  PERMISSION_KEYS,
  permissionKeySchema,
  SUPER_ADMIN_ONLY_PERMISSIONS,
} from '../src/permissions.ts'

const domainRules = readFileSync(new URL('../../../docs/DOMAIN_RULES.md', import.meta.url), 'utf8')

function documentedKeys(markdown: string): string[] {
  const section = markdown.split('## 9. Permissions')[1]?.split('\n## ')[0]
  if (section === undefined) {
    throw new Error('docs/DOMAIN_RULES.md has no "## 9. Permissions" section.')
  }
  return section
    .split('\n')
    .filter((line) => line.startsWith('|'))
    .flatMap((line) => [...(line.split('|')[2] ?? '').matchAll(/`([a-z]+\.[a-zA-Z]+)`/g)])
    .map((match) => match[1] ?? '')
}

describe('permission keys', () => {
  it('match the table in docs/DOMAIN_RULES.md section 9 exactly', () => {
    const documented = documentedKeys(domainRules)
    expect(documented.length).toBeGreaterThan(0)
    expect([...PERMISSION_KEYS].sort()).toEqual([...documented].sort())
  })

  it('have no edit keys for saved money records', () => {
    expect(permissionKeySchema.safeParse('income.edit').success).toBe(false)
    expect(permissionKeySchema.safeParse('expense.edit').success).toBe(false)
  })

  it('never give the Accountant a Super Admin only key by default', () => {
    for (const key of SUPER_ADMIN_ONLY_PERMISSIONS) {
      expect(ACCOUNTANT_DEFAULT_PERMISSIONS).not.toContain(key)
    }
  })

  it('let the Accountant request a void but not approve one', () => {
    expect(ACCOUNTANT_DEFAULT_PERMISSIONS).toContain('payments.requestVoid')
    expect(ACCOUNTANT_DEFAULT_PERMISSIONS).not.toContain('payments.void')
  })
})
