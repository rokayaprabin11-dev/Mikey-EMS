import {
  type DayCloseSnapshot,
  formatAdDate,
  formatBsDateLong,
  formatKathmanduTime,
  formatReceiptAmount,
  formatRupees,
  parseBsDate,
  printEn,
} from '@mikey/shared'

import { A5Layout, FOOTER_TOP, GAP, LEFT, type PrintDetails, RIGHT, TOP, WIDTH } from './a5.ts'
import { INK, LINE_HEIGHT, pt, renderPdf, RULE, type Run } from './layout.ts'

const words = printEn.dayClose

const SIZE = 12
const TITLE_SIZE = 14
const MIDDLE_WIDTH = 120
const AMOUNT_WIDTH = 110
const CELL_PADDING = 4
const ROW_PADDING = 4
const TOTALS_WIDTH = 260
const LABEL_X = LEFT + CELL_PADDING
const LABEL_WIDTH = WIDTH - MIDDLE_WIDTH - AMOUNT_WIDTH - 2 * CELL_PADDING
const MIDDLE_X = RIGHT - AMOUNT_WIDTH - MIDDLE_WIDTH

interface Row {
  label: string
  middle: string
  amount: number
}

interface Table {
  title: string
  columns: readonly [string, string, string]
  rows: readonly Row[]
  total: Row | null
}

function sum(items: readonly { amount: number }[]): number {
  return items.reduce((total, item) => total + item.amount, 0)
}

function voidText(item: DayCloseSnapshot['voids'][number]): string {
  const { target } = item
  let what: string
  if (target.type === 'payment') {
    what = words.voidOfReceipt(target.receiptNo)
  } else if (target.type === 'income') {
    what = words.voidOfIncome(target.description)
  } else {
    what = words.voidOfExpense(target.description)
  }
  return `${what}. ${words.voidedBy(printEn.voidReasons[item.reason], item.voidedBy)}.`
}

class DayCloseLayout extends A5Layout {
  private readonly snapshot: DayCloseSnapshot
  private readonly print: PrintDetails

  constructor(doc: PDFKit.PDFDocument, snapshot: DayCloseSnapshot, print: PrintDetails) {
    super(doc)
    this.snapshot = snapshot
    this.print = print
  }

  draw(): void {
    const { feesByMethod, incomeByCategory, expensesByCategory, voids } = this.snapshot
    this.header(this.snapshot.school, words.title, this.print.copy)
    this.details()
    this.cashCount()
    this.table({
      title: words.fees,
      columns: [words.method, words.receipts, words.amountColumn],
      rows: feesByMethod.map((item) => ({
        label: printEn.paymentMethods[item.method],
        middle: String(item.receiptCount),
        amount: item.amount,
      })),
      total: {
        label: words.total,
        middle: String(feesByMethod.reduce((total, item) => total + item.receiptCount, 0)),
        amount: sum(feesByMethod),
      },
    })
    for (const [title, items] of [
      [words.income, incomeByCategory],
      [words.expenses, expensesByCategory],
    ] as const) {
      this.table({
        title,
        columns: [words.category, '', words.amountColumn],
        rows: items.map((item) => ({ label: item.name, middle: '', amount: item.amount })),
        total: { label: words.total, middle: '', amount: sum(items) },
      })
    }
    this.table({
      title: words.voids,
      columns: [words.void, words.account, words.amountColumn],
      rows: voids.map((item) => ({ label: voidText(item), middle: item.accountName, amount: item.amount })),
      total: null,
    })
    this.endPage()
  }

  private details(): void {
    const { date, closedAt, closedBy } = this.snapshot
    this.y += GAP
    this.line(
      [
        { text: `${words.date} ` },
        { text: formatBsDateLong(parseBsDate(date.bs)), bold: true },
        { text: ` (${formatAdDate(date.ad)})` },
      ],
      LEFT,
      this.y,
      12,
    )
    this.line([{ text: `${words.closedAt} ` }, { text: formatKathmanduTime(new Date(closedAt)), bold: true }], LEFT, this.y, 12, {
      align: 'right',
      width: WIDTH,
    })
    this.y += 12 * LINE_HEIGHT + 4
    this.line(this.labelled(words.closedBy, closedBy, WIDTH, 12), LEFT, this.y, 12)
    this.y += 12 * LINE_HEIGHT
  }

  // The notes counted, then the count against the cashbook and the note about any difference.
  private cashCount(): void {
    const { counts, countedCash, expectedCash, difference, note } = this.snapshot
    this.table({
      title: words.cashCount,
      columns: [words.noteOrCoin, words.count, words.amountColumn],
      rows: counts.map((item) => ({
        label: formatRupees(item.note * 100),
        middle: String(item.count),
        amount: item.note * 100 * item.count,
      })),
      total: null,
    })

    const lineHeight = SIZE * LINE_HEIGHT
    let differenceLabel: string = words.noDifference
    if (difference < 0) {
      differenceLabel = words.short
    } else if (difference > 0) {
      differenceLabel = words.over
    }
    this.makeRoom(GAP + 3 * lineHeight + 4 + 4 + 1 + 5)
    const x = RIGHT - TOTALS_WIDTH
    const row = (label: string, amount: number | null, bold: boolean): void => {
      this.line([{ text: label, bold }], x, this.y, SIZE)
      if (amount !== null) {
        this.line([{ text: formatReceiptAmount(amount), bold }], x, this.y, SIZE, { align: 'right', width: TOTALS_WIDTH })
      }
    }
    this.y += GAP
    row(words.counted, countedCash, false)
    this.y += lineHeight + 4
    row(words.cashbookSays, expectedCash, false)
    this.y += lineHeight + 4
    this.rule(x, RIGHT, this.y + 0.5, 1, INK)
    this.y += 1 + 5
    row(differenceLabel, difference === 0 ? null : Math.abs(difference), true)
    this.y += lineHeight

    if (note !== null) {
      const runs: Run[] = [{ text: `${words.note} ` }, { text: note, bold: true }]
      this.makeRoom(GAP + this.measure(runs, SIZE, WIDTH))
      this.y += GAP
      this.y += this.paragraph(runs, LEFT, this.y, SIZE, WIDTH)
    }
  }

  private rowHeight(row: Row): number {
    return ROW_PADDING + Math.max(SIZE * LINE_HEIGHT, this.heightOf(row.label, 'bold', SIZE, LABEL_WIDTH)) + ROW_PADDING + 1
  }

  private tableHeader(columns: Table['columns']): void {
    this.rule(LEFT, RIGHT, this.y + 0.5, 1, INK)
    this.cells({ label: columns[0], middle: columns[1], amount: columns[2] }, this.y + 1 + ROW_PADDING, true)
    const bottom = this.y + 1 + ROW_PADDING + SIZE * LINE_HEIGHT + ROW_PADDING
    this.rule(LEFT, RIGHT, bottom + 0.5, 1, INK)
    this.y = bottom + 1
  }

  private cells(row: { label: string; middle: string; amount: string }, textY: number, bold: boolean): void {
    this.use(bold ? 'bold' : 'regular', SIZE)
    this.doc.text(row.label, pt(LABEL_X), pt(textY), { width: pt(LABEL_WIDTH) })
    this.line([{ text: this.fit(row.middle, bold ? 'bold' : 'regular', SIZE, MIDDLE_WIDTH), bold }], MIDDLE_X, textY, SIZE, {
      align: 'center',
      width: MIDDLE_WIDTH,
    })
    this.line([{ text: row.amount, bold }], RIGHT - AMOUNT_WIDTH, textY, SIZE, {
      align: 'right',
      width: AMOUNT_WIDTH - CELL_PADDING,
    })
  }

  private row(row: Row, total: boolean): void {
    const height = this.rowHeight(row)
    if (total) {
      this.rule(LEFT, RIGHT, this.y + 0.5, 1, INK)
    }
    this.cells({ label: row.label, middle: row.middle, amount: formatReceiptAmount(row.amount) }, this.y + ROW_PADDING, total)
    if (!total) {
      this.rule(LEFT, RIGHT, this.y + height - 0.5, 1, RULE)
    }
    this.y += height
  }

  // A titled table; "None." when it has no rows. The title never sits alone at the foot of a page.
  private table(table: Table): void {
    const titleHeight = GAP + TITLE_SIZE * LINE_HEIGHT + 4
    const [first] = table.rows
    const firstHeight = first === undefined ? SIZE * LINE_HEIGHT : 1 + 2 * ROW_PADDING + SIZE * LINE_HEIGHT + 1 + this.rowHeight(first)
    this.makeRoom(titleHeight + firstHeight)
    this.y += GAP
    this.use('display', TITLE_SIZE)
    this.doc.text(table.title, pt(LEFT), pt(this.y), { lineBreak: false })
    this.y += TITLE_SIZE * LINE_HEIGHT + 4
    if (first === undefined) {
      this.line([{ text: words.none }], LEFT, this.y, SIZE)
      this.y += SIZE * LINE_HEIGHT
      return
    }
    this.tableHeader(table.columns)
    for (const row of table.rows) {
      if (this.makeRoom(this.rowHeight(row))) {
        this.tableHeader(table.columns)
      }
      this.row(row, false)
    }
    if (table.total !== null) {
      this.makeRoom(this.rowHeight(table.total))
      this.row(table.total, true)
    }
  }

  // Starts a new page when the next block would run into the footer.
  private makeRoom(height: number): boolean {
    if (this.y + height <= FOOTER_TOP - GAP) {
      return false
    }
    this.endPage()
    this.doc.addPage()
    this.y = TOP
    return true
  }

  // Every page names the day it summarises, so a second page is never mistaken for another day's.
  private endPage(): void {
    this.footer(words.footer(formatBsDateLong(parseBsDate(this.snapshot.date.bs))), this.print)
  }
}

// Draws a day-close summary from its snapshot alone, so every print shows the day as it was closed.
export function renderDayCloseSummary(snapshot: DayCloseSnapshot, print: PrintDetails): Promise<Buffer> {
  const info = {
    Title: words.footer(formatBsDateLong(parseBsDate(snapshot.date.bs))),
    Author: snapshot.school.name,
    CreationDate: print.printedAt,
  }
  return renderPdf({ size: 'A5', info }, (doc) => {
    new DayCloseLayout(doc, snapshot, print).draw()
  })
}
