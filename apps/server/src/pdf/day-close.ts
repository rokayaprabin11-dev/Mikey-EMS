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
const CELL_PADDING = 4
const ROW_PADDING = 4
const TOTALS_WIDTH = 260
const AMOUNT = 105

interface Column {
  header: string
  // 0 takes what is left and wraps its text.
  width: number
  align: 'left' | 'center' | 'right'
}

interface Table {
  title: string
  columns: readonly Column[]
  rows: readonly (readonly string[])[]
  total: readonly string[] | null
}

function sum(amounts: readonly number[]): number {
  return amounts.reduce((total, amount) => total + amount, 0)
}

// Amounts are never printed with a minus sign: a method that paid back more than it took says so,
// and so does a balance below zero.
function net(amount: number): string {
  return amount < 0 ? words.back(formatReceiptAmount(-amount)) : formatReceiptAmount(amount)
}

function balance(amount: number): string {
  return amount < 0 ? words.belowZero(formatReceiptAmount(-amount)) : formatReceiptAmount(amount)
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
  private widths: number[] = []
  private columns: readonly Column[] = []

  constructor(doc: PDFKit.PDFDocument, snapshot: DayCloseSnapshot, print: PrintDetails) {
    super(doc)
    this.snapshot = snapshot
    this.print = print
  }

  draw(): void {
    const { feesByMethod, incomeByCategory, expensesByCategory, transfers, voids } = this.snapshot
    const amountColumn = { header: words.amountColumn, width: AMOUNT, align: 'right' } as const
    this.header(this.snapshot.school, words.title, this.print.copy)
    this.details()
    this.cashBook()
    this.cashCount()
    this.table({
      title: words.fees,
      columns: [
        { header: words.method, width: 0, align: 'left' },
        { header: words.receipts, width: 66, align: 'center' },
        { header: words.received, width: 95, align: 'right' },
        { header: words.voided, width: 95, align: 'right' },
        { header: words.net, width: AMOUNT, align: 'right' },
      ],
      rows: feesByMethod.map((item) => [
        printEn.paymentMethods[item.method],
        String(item.receiptCount),
        formatReceiptAmount(item.gross),
        formatReceiptAmount(item.voided),
        net(item.net),
      ]),
      total: [
        words.total,
        String(sum(feesByMethod.map((item) => item.receiptCount))),
        formatReceiptAmount(sum(feesByMethod.map((item) => item.gross))),
        formatReceiptAmount(sum(feesByMethod.map((item) => item.voided))),
        net(sum(feesByMethod.map((item) => item.net))),
      ],
    })
    for (const [title, items] of [
      [words.income, incomeByCategory],
      [words.expenses, expensesByCategory],
    ] as const) {
      this.table({
        title,
        columns: [{ header: words.category, width: 0, align: 'left' }, amountColumn],
        rows: items.map((item) => [item.name, formatReceiptAmount(item.amount)]),
        total: [words.total, formatReceiptAmount(sum(items.map((item) => item.amount)))],
      })
    }
    // Money moved between accounts is neither income nor an expense, so it is not added up.
    this.table({
      title: words.transfers,
      columns: [{ header: words.moved, width: 0, align: 'left' }, amountColumn],
      rows: transfers.map((item) => {
        const moved = words.transferLine(item.fromAccount, item.toAccount)
        return [item.note === null ? moved : `${moved}. ${item.note}`, formatReceiptAmount(item.amount)]
      }),
      total: null,
    })
    this.table({
      title: words.voids,
      columns: [
        { header: words.void, width: 0, align: 'left' },
        { header: words.account, width: 120, align: 'center' },
        amountColumn,
      ],
      rows: voids.map((item) => [voidText(item), item.accountName, formatReceiptAmount(item.amount)]),
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

  // Labels with their amounts, the amounts lined up on the right; the last line is bold under a
  // rule. `width` is measured back from the right edge.
  private totalsBlock(lines: readonly (readonly [string, string | null])[], width: number, gap: number): void {
    const lineHeight = SIZE * LINE_HEIGHT
    const x = RIGHT - width
    this.makeRoom(gap + lines.length * (lineHeight + 4) + 6)
    this.y += gap
    lines.forEach(([label, amount], index) => {
      const last = index === lines.length - 1
      if (last) {
        this.rule(x, RIGHT, this.y + 0.5, 1, INK)
        this.y += 1 + 5
      }
      this.line([{ text: label, bold: last }], x, this.y, SIZE)
      if (amount !== null) {
        this.line([{ text: amount, bold: last }], x, this.y, SIZE, { align: 'right', width })
      }
      this.y += lineHeight + (last ? 0 : 4)
    })
  }

  // The cash account's day, ending with the balance the count is checked against.
  private cashBook(): void {
    const { opening, moneyIn, moneyOut, closing } = this.snapshot.cashBook
    this.title(words.cashBook, GAP + TITLE_SIZE * LINE_HEIGHT + 4 + 4 * (SIZE * LINE_HEIGHT + 4))
    this.totalsBlock(
      [
        [words.opening, balance(opening)],
        [words.moneyIn, formatReceiptAmount(moneyIn)],
        [words.moneyOut, formatReceiptAmount(moneyOut)],
        [words.closing, formatReceiptAmount(closing)],
      ],
      WIDTH,
      0,
    )
  }

  // The notes counted, then the count against the cashbook and the note about any difference.
  private cashCount(): void {
    const { counts, countedCash, expectedCash, difference, note } = this.snapshot
    this.table({
      title: words.cashCount,
      columns: [
        { header: words.noteOrCoin, width: 0, align: 'left' },
        { header: words.count, width: 120, align: 'center' },
        { header: words.amountColumn, width: AMOUNT, align: 'right' },
      ],
      rows: counts.map((item) => [formatRupees(item.note * 100), String(item.count), formatReceiptAmount(item.note * 100 * item.count)]),
      total: null,
    })
    let differenceLabel: string = words.noDifference
    if (difference < 0) {
      differenceLabel = words.short
    } else if (difference > 0) {
      differenceLabel = words.over
    }
    this.totalsBlock(
      [
        [words.counted, formatReceiptAmount(countedCash)],
        [words.cashbookSays, formatReceiptAmount(expectedCash)],
        [differenceLabel, difference === 0 ? null : formatReceiptAmount(Math.abs(difference))],
      ],
      TOTALS_WIDTH,
      GAP,
    )
    if (note !== null) {
      const runs: Run[] = [{ text: `${words.note} ` }, { text: note, bold: true }]
      this.makeRoom(GAP + this.measure(runs, SIZE, WIDTH))
      this.y += GAP
      this.y += this.paragraph(runs, LEFT, this.y, SIZE, WIDTH)
    }
  }

  // A section title that never sits alone at the foot of a page: `room` is what must follow it.
  private title(text: string, room: number): void {
    this.makeRoom(room)
    this.y += GAP
    this.use('display', TITLE_SIZE)
    this.doc.text(text, pt(LEFT), pt(this.y), { lineBreak: false })
    this.y += TITLE_SIZE * LINE_HEIGHT + 4
  }

  private useColumns(columns: readonly Column[]): void {
    const fixed = columns.reduce((total, column) => total + column.width, 0)
    this.columns = columns
    this.widths = columns.map((column) => (column.width === 0 ? WIDTH - fixed : column.width))
  }

  private rowHeight(cells: readonly string[]): number {
    const heights = cells.map((text, index) =>
      this.columns[index]?.width === 0
        ? this.heightOf(text, 'bold', SIZE, (this.widths[index] ?? 0) - 2 * CELL_PADDING)
        : SIZE * LINE_HEIGHT,
    )
    return ROW_PADDING + Math.max(SIZE * LINE_HEIGHT, ...heights) + ROW_PADDING + 1
  }

  private cells(cells: readonly string[], textY: number, bold: boolean): void {
    let x = LEFT
    cells.forEach((text, index) => {
      const column = this.columns[index]
      const width = (this.widths[index] ?? 0) - 2 * CELL_PADDING
      if (column?.width === 0) {
        this.use(bold ? 'bold' : 'regular', SIZE)
        this.doc.text(text, pt(x + CELL_PADDING), pt(textY), { width: pt(width) })
      } else {
        this.line([{ text: this.fit(text, bold ? 'bold' : 'regular', SIZE, width), bold }], x + CELL_PADDING, textY, SIZE, {
          align: column?.align ?? 'left',
          width,
        })
      }
      x += this.widths[index] ?? 0
    })
  }

  private tableHeader(): void {
    this.rule(LEFT, RIGHT, this.y + 0.5, 1, INK)
    this.cells(
      this.columns.map((column) => column.header),
      this.y + 1 + ROW_PADDING,
      true,
    )
    const bottom = this.y + 1 + ROW_PADDING + SIZE * LINE_HEIGHT + ROW_PADDING
    this.rule(LEFT, RIGHT, bottom + 0.5, 1, INK)
    this.y = bottom + 1
  }

  private row(cells: readonly string[], total: boolean): void {
    const height = this.rowHeight(cells)
    if (this.makeRoom(height)) {
      this.tableHeader()
    }
    if (total) {
      this.rule(LEFT, RIGHT, this.y + 0.5, 1, INK)
    }
    this.cells(cells, this.y + ROW_PADDING, total)
    if (!total) {
      this.rule(LEFT, RIGHT, this.y + height - 0.5, 1, RULE)
    }
    this.y += height
  }

  // A titled table; "None." when it has no rows.
  private table(table: Table): void {
    this.useColumns(table.columns)
    const [first] = table.rows
    const headerHeight = 1 + 2 * ROW_PADDING + SIZE * LINE_HEIGHT + 1
    this.title(table.title, GAP + TITLE_SIZE * LINE_HEIGHT + 4 + (first === undefined ? SIZE * LINE_HEIGHT : headerHeight + this.rowHeight(first)))
    if (first === undefined) {
      this.line([{ text: words.none }], LEFT, this.y, SIZE)
      this.y += SIZE * LINE_HEIGHT
      return
    }
    this.tableHeader()
    for (const row of table.rows) {
      this.row(row, false)
    }
    if (table.total !== null) {
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
