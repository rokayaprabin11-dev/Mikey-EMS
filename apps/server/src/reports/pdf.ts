import {
  adToBs,
  formatAdDate,
  formatBsDateLong,
  formatBsWithAd,
  formatKathmanduTime,
  formatReceiptAmount,
  kathmanduDate,
  printEn,
  type Report,
} from '@mikey/shared'

import type { FontName } from '../pdf/fonts.ts'
import { INK, LINE_HEIGHT, PdfLayout, pt, renderPdf, RULE } from '../pdf/layout.ts'
import { columnTotal, type ReportTable, reportTable, type Value } from './table.ts'

const words = printEn.reports

// An A4 page is 595.28 × 841.89 points, so 794 × 1123 CSS pixels; the report in the Accountant
// design sets its sizes in CSS pixels.
const PAGE_WIDTH = 794
const PAGE_HEIGHT = 1123
const LEFT = 48
const RIGHT = PAGE_WIDTH - 48
const WIDTH = RIGHT - LEFT
const TOP = 44
const GAP = 12
const FOOTER_TOP = PAGE_HEIGHT - 36 - (1 + 8 + 12 * LINE_HEIGHT)
const SIZE = 11
const CELL_PADDING = 4
const ROW_PADDING = 5
const CREST_WIDTH = 36
const CREST_HEIGHT = 40
const HEADER_GAP = 24
const MUTED = '#3C4752'

function share(part: Value, whole: Value): string {
  return typeof part === 'number' && typeof whole === 'number' && whole > 0 ? `${Math.round((part * 100) / whole)}%` : ''
}

class ReportLayout extends PdfLayout {
  private readonly report: Report
  private readonly table: ReportTable
  private readonly widths: number[]
  private y = TOP

  constructor(doc: PDFKit.PDFDocument, report: Report) {
    super(doc)
    this.report = report
    this.table = reportTable(report)
    const fixed = this.table.columns.reduce((sum, column) => sum + column.width, 0)
    this.widths = this.table.columns.map((column) => (column.width === 0 ? WIDTH - fixed : column.width))
  }

  draw(): void {
    this.header()
    if (this.table.rows.length === 0) {
      this.y += GAP
      this.line([{ text: words.none }], LEFT, this.y, 12.5)
    } else {
      this.tableHeader()
      for (const row of this.table.rows) {
        this.row(row, false)
      }
      if (this.table.totals) {
        this.row(this.totalsRow(), true)
      }
      this.netLine()
    }
    this.footers()
  }

  // The totals row starts with its label, whatever the first column holds.
  private cellText(row: readonly Value[], index: number, total: boolean): string {
    const column = this.table.columns[index]
    const value = row[index]
    if (column === undefined) {
      return ''
    }
    if (total && index === 0) {
      return String(value)
    }
    if (column.kind === 'share' && column.share !== undefined) {
      return share(row[column.share[0]] ?? null, row[column.share[1]] ?? null)
    }
    if (value === null || value === undefined) {
      return ''
    }
    switch (column.kind) {
      case 'bsDate':
        return formatBsDateLong(adToBs(String(value)))
      case 'adDate':
        return formatAdDate(String(value))
      case 'amount':
        return formatReceiptAmount(Number(value))
      default:
        return String(value)
    }
  }

  private totalsRow(): Value[] {
    return this.table.columns.map((column, index) => {
      if (index === 0) {
        return words.total
      }
      return column.total === true ? columnTotal(this.table, index) : null
    })
  }

  private header(): void {
    const { header } = this.report
    const generated = new Date(header.generatedAt)
    const right = [
      words.period(formatBsWithAd(header.from), formatBsWithAd(header.to)),
      words.generated(formatBsWithAd(kathmanduDate(generated)), formatKathmanduTime(generated), header.generatedBy),
    ].join('\n')
    // The school and the title take what they need, up to half the page; the period and the
    // generated line get the rest.
    const textX = LEFT + CREST_WIDTH + 14
    const textWidth = Math.min(
      Math.max(this.widthOf(header.schoolName, 'display', 18), this.widthOf(this.table.title, 'display', 24)),
      WIDTH / 2,
    )
    const rightWidth = RIGHT - (textX + textWidth + HEADER_GAP)
    const nameHeight = this.heightOf(header.schoolName, 'display', 18, textWidth)
    const titleHeight = this.heightOf(this.table.title, 'display', 24, textWidth)
    const rightHeight = this.heightOf(right, 'regular', 12, rightWidth)
    const height = Math.max(CREST_HEIGHT, nameHeight + titleHeight, rightHeight)

    this.crest(LEFT, this.y + (height - CREST_HEIGHT) / 2, CREST_WIDTH)
    let textY = this.y + (height - nameHeight - titleHeight) / 2
    this.use('display', 18)
    this.doc.text(header.schoolName, pt(textX), pt(textY), { width: pt(textWidth) })
    textY += nameHeight
    this.use('display', 24)
    this.doc.text(this.table.title, pt(textX), pt(textY), { width: pt(textWidth) })
    this.use('regular', 12, MUTED)
    this.doc.text(right, pt(RIGHT - rightWidth), pt(this.y + (height - rightHeight) / 2), {
      width: pt(rightWidth),
      align: 'right',
    })
    this.rule(LEFT, RIGHT, this.y + height + 12 + 1, 2, INK)
    this.y += height + 12 + 2 + GAP
  }

  // A later page says which report it continues.
  private newPage(): void {
    this.doc.addPage()
    this.y = TOP
    const text = `${this.report.header.schoolName}, ${words.continued(this.table.title)}`
    this.line([{ text: this.fit(text, 'bold', 12, WIDTH), bold: true }], LEFT, this.y, 12)
    this.y += 12 * LINE_HEIGHT + 6
    this.rule(LEFT, RIGHT, this.y + 0.5, 1, INK)
    this.y += 1 + GAP
  }

  private makeRoom(height: number): boolean {
    if (this.y + height <= FOOTER_TOP - GAP) {
      return false
    }
    this.newPage()
    return true
  }

  // Text in the column that takes what is left wraps; every other cell is shortened to fit.
  private cellHeight(text: string, index: number, font: FontName): number {
    const width = (this.widths[index] ?? 0) - 2 * CELL_PADDING
    return this.table.columns[index]?.width === 0 ? this.heightOf(text, font, SIZE, width) : SIZE * LINE_HEIGHT
  }

  private cells(texts: readonly string[], textY: number, font: FontName, colour = INK): void {
    let x = LEFT
    texts.forEach((text, index) => {
      const column = this.table.columns[index]
      const width = (this.widths[index] ?? 0) - 2 * CELL_PADDING
      const right = column !== undefined && column.kind !== 'text' && column.kind !== 'bsDate' && column.kind !== 'adDate'
      if (column?.width === 0) {
        this.use(font, SIZE, colour)
        this.doc.text(text, pt(x + CELL_PADDING), pt(textY), { width: pt(width) })
      } else {
        this.line([{ text: this.fit(text, font, SIZE, width), bold: font === 'bold' }], x + CELL_PADDING, textY, SIZE, {
          align: right ? 'right' : 'left',
          width,
          colour,
        })
      }
      x += this.widths[index] ?? 0
    })
  }

  private tableHeader(): void {
    const texts = this.table.columns.map((column) => column.header)
    const height = Math.max(...texts.map((text, index) => this.cellHeight(text, index, 'bold')))
    this.cells(texts, this.y + ROW_PADDING, 'bold', MUTED)
    this.y += ROW_PADDING + height + ROW_PADDING
    this.rule(LEFT, RIGHT, this.y + 0.5, 1, INK)
    this.y += 1
  }

  private row(row: readonly Value[], total: boolean): void {
    const font: FontName = total ? 'bold' : 'regular'
    const texts = row.map((_value, index) => this.cellText(row, index, total))
    const height = ROW_PADDING + Math.max(...texts.map((text, index) => this.cellHeight(text, index, font))) + ROW_PADDING + 2
    if (this.makeRoom(height)) {
      this.tableHeader()
    }
    if (total) {
      this.rule(LEFT, RIGHT, this.y + 1, 2, INK)
    }
    this.cells(texts, this.y + ROW_PADDING + (total ? 2 : 0), font)
    if (!total) {
      this.rule(LEFT, RIGHT, this.y + height - 0.5, 1, RULE)
    }
    this.y += height
  }

  private netLine(): void {
    const { net } = this.table
    if (net === null) {
      return
    }
    const value = columnTotal(this.table, net.columns[0]) - columnTotal(this.table, net.columns[1])
    const text = `${value < 0 ? net.negative : net.positive} ${formatReceiptAmount(Math.abs(value))}`
    this.makeRoom(GAP + 12.5 * LINE_HEIGHT)
    this.y += GAP
    this.line([{ text, bold: true }], LEFT, this.y, 12.5, { align: 'right', width: WIDTH - CELL_PADDING })
    this.y += 12.5 * LINE_HEIGHT
  }

  // Footers go on once every page is drawn, so each can say how many pages there are.
  private footers(): void {
    const { start, count } = this.doc.bufferedPageRange()
    for (let page = start; page < start + count; page += 1) {
      this.doc.switchToPage(page)
      const textY = FOOTER_TOP + 1 + 8
      this.rule(LEFT, RIGHT, FOOTER_TOP + 0.5, 1, RULE)
      const pageText = words.page(page - start + 1, count)
      const pageWidth = this.widthOf(pageText, 'regular', 12)
      this.line([{ text: this.fit(this.table.note, 'regular', 12, WIDTH - pageWidth - 24) }], LEFT, textY, 12, { colour: MUTED })
      this.line([{ text: pageText }], LEFT, textY, 12, { align: 'right', width: WIDTH, colour: MUTED })
    }
  }
}

export function renderReportPdf(report: Report): Promise<Buffer> {
  const info = {
    Title: `${words.titles[report.type]}, ${formatBsWithAd(report.header.from)} to ${formatBsWithAd(report.header.to)}`,
    Author: report.header.schoolName,
    CreationDate: new Date(report.header.generatedAt),
  }
  return renderPdf({ size: 'A4', bufferPages: true, info }, (doc) => {
    new ReportLayout(doc, report).draw()
  })
}
