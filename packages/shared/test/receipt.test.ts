import { describe, expect, it } from 'vitest'

import { bsToAd } from '../src/date.ts'
import { buildReceiptSnapshot, type ReceiptSnapshotInput } from '../src/receipt.ts'

const tuition = (month: number, amount: number, part: { wasPartPaid?: boolean; clearsDue?: boolean } = {}) => ({
  kind: 'fee' as const,
  headName: 'Monthly tuition',
  monthly: true,
  periodLabel: `${['Ashwin', 'Kartik'][month - 6] ?? ''} 2083`,
  billDate: bsToAd({ year: 2083, month, day: 1 }),
  amount,
  wasPartPaid: part.wasPartPaid ?? false,
  clearsDue: part.clearsDue ?? true,
})

// The receipt drawn in the Accountant design: Bibek Lama pays the rest of Ashwin, its late fine
// and Kartik.
const bibek: ReceiptSnapshotInput = {
  school: { name: 'Mikey English Medium School', address: null, phone: null, pan: null },
  receiptNo: '2083/84-001285',
  sessionName: '2083',
  issuedAt: new Date('2026-10-29T05:13:00.000Z'),
  paidDate: '2026-10-29',
  student: {
    code: 'MEMS-2076-0098',
    fullName: 'Bibek Lama',
    className: 'Class 7',
    sectionName: 'A',
    rollNo: 17,
    guardianName: 'Pasang Lama',
  },
  lines: [
    tuition(6, 168_000, { wasPartPaid: true }),
    { kind: 'fine', reason: 'Late fine, Ashwin 2083', amount: 10_000 },
    tuition(7, 368_000),
  ],
  duesBefore: 546_000,
  discount: 0,
  method: 'cash',
  reference: null,
  receivedBy: 'Bikash Maharjan',
}

describe('receipt snapshot', () => {
  it('holds everything the design prints', () => {
    expect(buildReceiptSnapshot(bibek)).toEqual({
      version: 1,
      school: { name: 'Mikey English Medium School', address: null, phone: null, pan: null, logo: null },
      receiptNo: '2083/84-001285',
      fiscalYear: '2083/84',
      sessionName: '2083',
      issuedAt: '2026-10-29T05:13:00.000Z',
      date: { ad: '2026-10-29', bs: '2083-07-12' },
      student: bibek.student,
      months: 'Ashwin and Kartik 2083',
      lines: [
        { label: 'Monthly tuition, Ashwin 2083 (balance)', amount: 168_000 },
        { label: 'Late fine, Ashwin 2083', amount: 10_000 },
        { label: 'Monthly tuition, Kartik 2083', amount: 368_000 },
      ],
      totals: { duesBefore: 546_000, discount: 0, amountPaid: 546_000, balanceAfter: 0 },
      amountInWords: 'Rupees Five Thousand Four Hundred Sixty Only',
      method: 'cash',
      reference: null,
      receivedBy: 'Bikash Maharjan',
    })
  })

  it('marks a part payment and keeps the rest as still due', () => {
    const snapshot = buildReceiptSnapshot({
      ...bibek,
      lines: [tuition(6, 200_000, { clearsDue: false })],
      duesBefore: 378_000,
    })
    expect(snapshot.lines).toEqual([{ label: 'Monthly tuition, Ashwin 2083 (part)', amount: 200_000 }])
    expect(snapshot.totals).toEqual({ duesBefore: 378_000, discount: 0, amountPaid: 200_000, balanceAfter: 178_000 })
    expect(snapshot.months).toBe('Ashwin 2083')
  })

  it('names the year of each month when the months cross a year', () => {
    const chaitra = { ...tuition(6, 100_000), periodLabel: 'Chaitra 2083', billDate: bsToAd({ year: 2083, month: 12, day: 1 }) }
    const baishakh = { ...tuition(6, 100_000), periodLabel: 'Baishakh 2084', billDate: bsToAd({ year: 2084, month: 1, day: 1 }) }
    const snapshot = buildReceiptSnapshot({ ...bibek, lines: [baishakh, chaitra], duesBefore: 200_000 })
    expect(snapshot.months).toBe('Chaitra 2083 and Baishakh 2084')
  })

  it('leaves out the months line when nothing monthly is paid', () => {
    const annual = { ...tuition(6, 736_000), headName: 'Annual', monthly: false, periodLabel: '2083' }
    expect(buildReceiptSnapshot({ ...bibek, lines: [annual], duesBefore: 736_000 }).months).toBeNull()
  })

  it('refuses a payment larger than what was due', () => {
    expect(() => buildReceiptSnapshot({ ...bibek, duesBefore: 500_000 })).toThrow()
  })

  it('refuses a receipt number from another fiscal year', () => {
    expect(() => buildReceiptSnapshot({ ...bibek, receiptNo: '2082/83-000001' })).toThrow(/another fiscal year/)
  })
})
