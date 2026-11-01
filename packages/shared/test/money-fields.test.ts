import { describe, expect, it } from 'vitest'

import { endpoints } from '../src/api/contract.ts'

// Fields that hold money in the replies. Money is always a whole number of paisa (AGENTS.md rule 1).
const MONEY_FIELDS = new Set([
  'amount',
  'amountPaid',
  'balance',
  'balanceAfter',
  'billed',
  'closingBalance',
  'collected',
  'countedCash',
  'difference',
  'discount',
  'duesBefore',
  'expectedCash',
  'expensesThisMonth',
  'incomeThisMonth',
  'moneyIn',
  'moneyOut',
  'net',
  'openingBalance',
  'outstanding',
  'over',
  'paid',
  'received',
  'remaining',
  'short',
  'spent',
  'total',
  'voided',
])

interface Def {
  type: string
  format?: string
  checks?: { _zod: { def: { check: string; format?: string } } }[]
  [key: string]: unknown
}

interface Schema {
  _zod: { def: Def }
}

interface Leaf {
  path: string
  key: string
  def: Def
}

function isInteger(def: Def): boolean {
  if (def.type === 'literal') {
    return (def.values as unknown[]).every((value) => typeof value !== 'number' || Number.isInteger(value))
  }
  return def.format === 'safeint' || (def.checks ?? []).some((check) => check._zod.def.format === 'safeint')
}

// Every leaf of a schema, through objects, arrays, unions and the wrappers around them.
function leaves(schema: Schema, path: string, key: string): Leaf[] {
  const { def } = schema._zod
  switch (def.type) {
    case 'object':
      return Object.entries(def.shape as Record<string, Schema>).flatMap(([name, inner]) => leaves(inner, `${path}.${name}`, name))
    case 'array':
      return leaves(def.element as Schema, `${path}[]`, key)
    case 'nullable':
    case 'optional':
    case 'default':
    case 'readonly':
      return leaves(def.innerType as Schema, path, key)
    case 'union':
      return (def.options as Schema[]).flatMap((option) => leaves(option, path, key))
    case 'pipe':
      return [...leaves(def.in as Schema, path, key), ...leaves(def.out as Schema, path, key)]
    default:
      return [{ path, key, def }]
  }
}

const replies = Object.entries(endpoints).flatMap(([name, endpoint]) =>
  typeof endpoint.response === 'object' ? leaves(endpoint.response as unknown as Schema, name, '') : [],
)

describe('money in the replies', () => {
  it('reaches every field, deep ones too', () => {
    expect(replies.map((leaf) => leaf.path)).toContain('getPayment.snapshot.totals.duesBefore')
    expect(replies.filter((leaf) => MONEY_FIELDS.has(leaf.key)).length).toBeGreaterThan(100)
  })

  it('has no number that is not a whole number', () => {
    const fractional = replies.filter((leaf) => (leaf.def.type === 'number' || leaf.def.type === 'literal') && !isInteger(leaf.def))
    expect(fractional.map((leaf) => leaf.path)).toEqual([])
  })

  it('keeps every money field as a whole number of paisa', () => {
    const notPaisa = replies.filter((leaf) => MONEY_FIELDS.has(leaf.key) && !(leaf.def.type === 'number' && isInteger(leaf.def)))
    expect(notPaisa.map((leaf) => `${leaf.path} (${leaf.def.type})`)).toEqual([])
  })
})
