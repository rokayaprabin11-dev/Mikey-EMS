import { describe, expect, it } from 'vitest'

import { describeDues } from './dues.ts'

const fee = (periodLabel: string, partPaid = false, headName = 'Monthly tuition') => ({ kind: 'fee' as const, headName, periodLabel, partPaid })
const fine = { kind: 'fine' as const, headName: 'Monthly tuition', periodLabel: 'Ashwin 2083', partPaid: false }

describe('what a student owes, in a few words', () => {
  it.each([
    [[fee('Kartik 2083')], 'Kartik 2083'],
    [[fee('Ashwin 2083'), fee('Kartik 2083')], 'Ashwin 2083 and Kartik 2083'],
    [[fee('Ashwin 2083', true), fee('Kartik 2083'), fine], 'Ashwin 2083 balance, Kartik 2083 and a fine'],
    [[fee('2083', false, 'Admission fee'), fee('Kartik 2083')], 'Admission fee and Kartik 2083'],
    [[fee('First term 2083', false, 'Exam fee')], 'First term 2083'],
    [[fine, fine], '2 fines'],
    [
      [fee('Baishakh 2083'), fee('Jestha 2083'), fee('Asar 2083'), fee('Shrawan 2083'), fine],
      'Baishakh 2083, Jestha 2083, 2 more and a fine',
    ],
  ])('%j reads "%s"', (items, words) => {
    expect(describeDues(items)).toBe(words)
  })
})
