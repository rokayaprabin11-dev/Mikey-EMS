import { formatKathmanduTime, printEn, type Report } from '@mikey/shared'

const words = printEn.reports

// What a column holds. Dates are AD dates, shown in BS or AD; amounts are paisa.
export type ColumnKind = 'text' | 'bsDate' | 'adDate' | 'amount' | 'count' | 'share'

export interface Column {
  header: string
  kind: ColumnKind
  // Width on the A4 page in CSS pixels; 0 takes what is left and wraps its text.
  width: number
  // Width in the spreadsheet, in characters.
  excelWidth: number
  // Summed in the totals row.
  total?: boolean
  // A 'share' column: the first column as a part of the second (paid out of billed).
  share?: readonly [number, number]
}

export type Value = string | number | null

// A line under the totals: the first summed column less the second, named by which is larger.
export interface NetLine {
  columns: readonly [number, number]
  positive: string
  negative: string
}

export interface ReportTable {
  title: string
  note: string
  columns: readonly Column[]
  rows: readonly Value[][]
  totals: boolean
  net: NetLine | null
}

const dates = [
  { header: words.dateBs, kind: 'bsDate', width: 92, excelWidth: 18 },
  { header: words.dateAd, kind: 'adDate', width: 74, excelWidth: 13 },
] as const satisfies readonly Column[]

function amount(header: string, width = 84, total = true): Column {
  return { header, kind: 'amount', width, excelWidth: 16, total }
}

export function reportTable(report: Report): ReportTable {
  const title = words.titles[report.type]
  switch (report.type) {
    case 'fee_collection':
      return {
        title,
        note: `${words.inRupees} ${words.voidsNote}`,
        columns: [
          ...dates,
          { header: words.receiptNo, kind: 'text', width: 104, excelWidth: 17 },
          { header: words.student, kind: 'text', width: 0, excelWidth: 40 },
          { header: words.class, kind: 'text', width: 64, excelWidth: 12 },
          { header: words.method, kind: 'text', width: 78, excelWidth: 14 },
          amount(words.received),
          amount(words.voided),
        ],
        rows: report.rows.map((row) => {
          const voided = row.kind === 'void'
          const student =
            voided && row.reason !== null && row.voidedBy !== null
              ? words.voidOf(row.studentName, printEn.voidReasons[row.reason], row.voidedBy)
              : row.studentName
          return [
            row.date,
            row.date,
            row.receiptNo,
            student,
            `${row.className} ${row.sectionName}`,
            printEn.paymentMethods[row.method],
            voided ? null : row.amount,
            voided ? row.amount : null,
          ]
        }),
        totals: true,
        net: { columns: [6, 7], positive: words.netCollected, negative: words.netPaidBack },
      }
    case 'dues':
      return {
        title,
        note: `${words.inRupees} ${words.duesNote}`,
        columns: [
          { header: words.class, kind: 'text', width: 0, excelWidth: 20 },
          { header: words.studentsBilled, kind: 'count', width: 90, excelWidth: 15, total: true },
          { header: words.studentsOwing, kind: 'count', width: 80, excelWidth: 12, total: true },
          amount(words.billed, 110),
          amount(words.paid, 110),
          amount(words.outstanding, 110),
          { header: words.collected, kind: 'share', width: 70, excelWidth: 11, share: [4, 3] },
        ],
        rows: report.rows.map((row) => [row.className, row.studentsBilled, row.studentsOwing, row.billed, row.paid, row.outstanding, null]),
        totals: true,
        net: null,
      }
    case 'expenses':
      return {
        title,
        note: `${words.inRupees} ${words.voidsNote}`,
        columns: [
          ...dates,
          { header: words.category, kind: 'text', width: 110, excelWidth: 22 },
          { header: words.description, kind: 'text', width: 0, excelWidth: 40 },
          { header: words.account, kind: 'text', width: 86, excelWidth: 16 },
          amount(words.spent),
          amount(words.voided),
        ],
        rows: report.rows.map((row) => {
          const described = row.voucherNo === null ? row.description : `${row.description}, ${words.voucher(row.voucherNo)}`
          const voided = row.kind === 'void'
          const description =
            voided && row.reason !== null && row.voidedBy !== null
              ? words.voidOf(described, printEn.voidReasons[row.reason], row.voidedBy)
              : described
          return [row.date, row.date, row.categoryName, description, row.accountName, voided ? null : row.amount, voided ? row.amount : null]
        }),
        totals: true,
        net: { columns: [5, 6], positive: words.netSpent, negative: words.netReturned },
      }
    case 'day_closes':
      return {
        title,
        note: words.inRupees,
        columns: [
          ...dates,
          { header: words.closedBy, kind: 'text', width: 112, excelWidth: 26 },
          amount(words.cashbookSaid, 90, false),
          amount(words.counted, 90, false),
          amount(words.short, 70),
          amount(words.over, 70),
          { header: words.note, kind: 'text', width: 0, excelWidth: 40 },
        ],
        rows: report.rows.map((row) => [
          row.date,
          row.date,
          `${row.closedBy}, ${formatKathmanduTime(new Date(row.closedAt))}`,
          row.expectedCash,
          row.countedCash,
          row.difference < 0 ? -row.difference : null,
          row.difference > 0 ? row.difference : null,
          row.note ?? '',
        ]),
        totals: true,
        net: null,
      }
  }
}

// The total of a summed column, worked out the same way the spreadsheet's SUM does.
export function columnTotal(table: ReportTable, column: number): number {
  return table.rows.reduce((total, row) => total + (typeof row[column] === 'number' ? row[column] : 0), 0)
}
