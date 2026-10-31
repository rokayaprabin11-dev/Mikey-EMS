import { type PaymentMethod, type ReceiptSnapshot, receiptSnapshotSchema } from './api/fees.ts'
import { type AdDate, adToBs, type BsDate, bsMonthName, fiscalYearOf, formatBsDate } from './date.ts'
import { printEn } from './i18n/print.en.ts'
import { amountInWords } from './money.ts'

const words = printEn.receipt

export type ReceiptLineInput =
  | {
      kind: 'fee'
      headName: string
      monthly: boolean
      periodLabel: string
      billDate: AdDate
      amount: number
      wasPartPaid: boolean
      clearsDue: boolean
    }
  | { kind: 'fine'; reason: string; amount: number }

export interface ReceiptSnapshotInput {
  school: { name: string; address: string | null; phone: string | null; pan: string | null }
  receiptNo: string
  sessionName: string
  issuedAt: Date
  paidDate: AdDate
  student: {
    code: string
    fullName: string
    className: string
    sectionName: string
    rollNo: number
    guardianName: string | null
  }
  lines: readonly ReceiptLineInput[]
  duesBefore: number
  discount: number
  method: PaymentMethod
  reference: string | null
  receivedBy: string
}

function lineLabel(line: ReceiptLineInput): string {
  if (line.kind === 'fine') {
    return line.reason
  }
  const label = `${line.headName}, ${line.periodLabel}`
  if (!line.clearsDue) {
    return `${label} ${words.partOfDue}`
  }
  return line.wasPartPaid ? `${label} ${words.balanceOfDue}` : label
}

function joinWithAnd(items: readonly string[]): string {
  const last = items.at(-1)
  if (last === undefined || items.length === 1) {
    return last ?? ''
  }
  return `${items.slice(0, -1).join(', ')} ${words.and} ${last}`
}

// "Ashwin and Kartik 2083", or "Chaitra 2083 and Baishakh 2084" across two years. Months come from
// the bill dates of monthly dues, so the wording never depends on how a period label is typed.
function monthsCovered(lines: readonly ReceiptLineInput[]): string | null {
  const months = new Map<string, BsDate>()
  for (const line of lines) {
    if (line.kind === 'fee' && line.monthly) {
      const bs = adToBs(line.billDate)
      months.set(formatBsDate({ ...bs, day: 1 }), bs)
    }
  }
  const sorted = [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, bs]) => bs)
  const [first] = sorted
  if (first === undefined) {
    return null
  }
  if (sorted.every((bs) => bs.year === first.year)) {
    return `${joinWithAnd(sorted.map((bs) => bsMonthName(bs.month)))} ${first.year}`
  }
  return joinWithAnd(sorted.map((bs) => `${bsMonthName(bs.month)} ${bs.year}`))
}

export function buildReceiptSnapshot(input: ReceiptSnapshotInput): ReceiptSnapshot {
  const amountPaid = input.lines.reduce((sum, line) => sum + line.amount, 0)
  const paidOn = adToBs(input.paidDate)
  return receiptSnapshotSchema.parse({
    version: 1,
    school: { ...input.school, logo: null },
    receiptNo: input.receiptNo,
    fiscalYear: fiscalYearOf(paidOn),
    sessionName: input.sessionName,
    issuedAt: input.issuedAt.toISOString(),
    date: { ad: input.paidDate, bs: formatBsDate(paidOn) },
    student: input.student,
    months: monthsCovered(input.lines),
    lines: input.lines.map((line) => ({ label: lineLabel(line), amount: line.amount })),
    totals: {
      duesBefore: input.duesBefore,
      discount: input.discount,
      amountPaid,
      balanceAfter: input.duesBefore - amountPaid,
    },
    amountInWords: amountInWords(amountPaid),
    method: input.method,
    reference: input.reference,
    receivedBy: input.receivedBy,
  })
}
