import type { FinanceDashboard } from '@mikey/shared'

import { en } from '../i18n/en.ts'

const words = en.dashboard

type DueItem = FinanceDashboard['largestDues'][number]['items'][number]

// More than this many fee items are cut short: "Baishakh 2083, Jestha 2083 and 3 more".
const NAMED_ITEMS = 3

// One due as a short phrase: its period ("Kartik 2083"), or its fee head when the period is only
// the year ("Admission fee"), with "balance" when part of it is paid.
function feeLabel(item: DueItem): string {
  const label = /^\d{4}$/.test(item.periodLabel) ? item.headName : item.periodLabel
  return item.partPaid ? words.balance(label) : label
}

function joined(parts: string[]): string {
  return parts.length < 2 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} ${words.and} ${parts.at(-1) ?? ''}`
}

// What a student owes, as the "Largest dues" list says it: "Ashwin 2083 balance, Kartik 2083 and
// a fine". Fines are counted rather than named.
export function describeDues(items: readonly DueItem[]): string {
  const fees = items.filter((item) => item.kind === 'fee').map(feeLabel)
  const fines = items.filter((item) => item.kind === 'fine').length
  const named = fees.length > NAMED_ITEMS ? [...fees.slice(0, 2), words.more(fees.length - 2)] : fees
  return joined(fines === 0 ? named : [...named, words.fines(fines)])
}
