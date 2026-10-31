import {
  formatAdDate,
  formatBsDateLong,
  formatKathmanduTime,
  formatReceiptAmount,
  parseBsDate,
  printEn,
  type ReceiptSnapshot,
} from '@mikey/shared'
import PDFDocument from 'pdfkit'

import { type FontName, registerFonts } from './fonts.ts'

const words = printEn.receipt

// Measurements are from the A5 receipt in the Accountant design, which is 559 × 794 CSS pixels.
// A CSS pixel is 0.75 PDF points.
const PT_PER_PX = 0.75
const PAGE_WIDTH = 559
const PAGE_HEIGHT = 794
const LEFT = 42
const RIGHT = PAGE_WIDTH - 42
const WIDTH = RIGHT - LEFT
const TOP = 40
const GAP = 12
const LINE_HEIGHT = 1.3
const FOOTER_TOP = PAGE_HEIGHT - 36 - (1 + 8 + 12 * LINE_HEIGHT)
const SIGNATURES_HEIGHT = 92
const SIGNATURES_TOP = FOOTER_TOP - GAP - SIGNATURES_HEIGHT
const SIGNATURE_LINE = 170
const SERIAL_WIDTH = 44
const AMOUNT_WIDTH = 110
const CELL_PADDING = 4
const ROW_PADDING = 6
const TOTALS_WIDTH = 260
const CREST_WIDTH = 46
const CREST_HEIGHT = 51

const INK = '#111A22'
const RULE = '#C9D1CE'
const CREST = '#8C1D2F'
const STAMP_RING = '#767676'
const STAMP_TEXT = '#4A5560'
const FOOTER_TEXT = '#3C4752'

// The placeholder crest from the design, drawn in a 40 × 44 box.
const CREST_SHIELD = 'M20 2 L37 8 V22 C37 32 29 39 20 42 C11 39 3 32 3 22 V8 Z'
const CREST_LETTER = 'M11 30 V14 L20 24 L29 14 V30'

export interface PrintDetails {
  printedAt: Date
  computer: 1 | 2
}

interface Run {
  text: string
  bold?: boolean
}

interface LineOptions {
  align?: 'left' | 'right' | 'center'
  width?: number
  colour?: string
}

function pt(px: number): number {
  return px * PT_PER_PX
}

class ReceiptLayout {
  private readonly doc: PDFKit.PDFDocument
  private readonly snapshot: ReceiptSnapshot
  private readonly print: PrintDetails
  private y = TOP

  constructor(doc: PDFKit.PDFDocument, snapshot: ReceiptSnapshot, print: PrintDetails) {
    this.doc = doc
    this.snapshot = snapshot
    this.print = print
  }

  draw(): void {
    this.header()
    this.details()
    this.studentBox()
    this.lines()
    this.totalsAndPayment()
    this.signatures()
    this.footer()
  }

  private use(font: FontName, size: number, colour = INK): void {
    this.doc.font(font).fontSize(pt(size)).fillColor(colour)
  }

  private widthOf(text: string, font: FontName, size: number): number {
    this.doc.font(font).fontSize(pt(size))
    return this.doc.widthOfString(text) / PT_PER_PX
  }

  private heightOf(text: string, font: FontName, size: number, width: number): number {
    this.doc.font(font).fontSize(pt(size))
    return this.doc.heightOfString(text, { width: pt(width) }) / PT_PER_PX
  }

  private fontOf(run: Run): FontName {
    return run.bold === true ? 'bold' : 'regular'
  }

  // Shortens text with an ellipsis until it fits the width.
  private fit(text: string, font: FontName, size: number, width: number): string {
    if (this.widthOf(text, font, size) <= width) {
      return text
    }
    let cut = text
    while (cut.length > 1 && this.widthOf(`${cut}…`, font, size) > width) {
      cut = cut.slice(0, -1)
    }
    return `${cut.trimEnd()}…`
  }

  // One line of regular and bold runs, never wrapped.
  private line(runs: readonly Run[], x: number, y: number, size: number, options: LineOptions = {}): void {
    const { align = 'left', width = 0, colour = INK } = options
    const total = runs.reduce((sum, run) => sum + this.widthOf(run.text, this.fontOf(run), size), 0)
    let cursor = x
    if (align === 'right') {
      cursor = x + width - total
    } else if (align === 'center') {
      cursor = x + (width - total) / 2
    }
    for (const run of runs) {
      this.use(this.fontOf(run), size, colour)
      this.doc.text(run.text, pt(cursor), pt(y), { lineBreak: false })
      cursor += this.widthOf(run.text, this.fontOf(run), size)
    }
  }

  // Regular and bold runs that wrap within the width. Measured in the wider bold face, so the
  // next block never overlaps it.
  private measure(runs: readonly Run[], size: number, width: number): number {
    return this.heightOf(runs.map((run) => run.text).join(''), 'bold', size, width)
  }

  private paragraph(runs: readonly Run[], x: number, y: number, size: number, width: number): number {
    runs.forEach((run, index) => {
      this.use(this.fontOf(run), size)
      const options = { width: pt(width), continued: index < runs.length - 1 }
      if (index === 0) {
        this.doc.text(run.text, pt(x), pt(y), options)
      } else {
        this.doc.text(run.text, options)
      }
    })
    return this.measure(runs, size, width)
  }

  private rule(from: number, to: number, y: number, thickness: number, colour: string): void {
    this.doc.moveTo(pt(from), pt(y)).lineTo(pt(to), pt(y)).lineWidth(pt(thickness)).strokeColor(colour).stroke()
  }

  // A label followed by its value in bold, the value shortened to fit the width.
  private labelled(label: string, value: string, width: number, size: number): Run[] {
    const room = width - this.widthOf(`${label} `, 'regular', size)
    return [{ text: `${label} ` }, { text: this.fit(value, 'bold', size, room), bold: true }]
  }

  private crest(x: number, y: number): void {
    this.doc.save().translate(pt(x), pt(y)).scale(pt(CREST_WIDTH) / 40)
    this.doc.path(CREST_SHIELD).fill(CREST)
    this.doc.path(CREST_LETTER).lineWidth(3).lineJoin('round').strokeColor('#FFFFFF').stroke()
    this.doc.restore()
  }

  private header(): void {
    const { school } = this.snapshot
    const contact = [
      school.phone === null ? null : `${words.phone} ${school.phone}`,
      school.pan === null ? null : `${words.pan} ${school.pan}`,
    ]
      .filter((part) => part !== null)
      .join('   ')
    const titleWidth = Math.max(this.widthOf(words.title, 'display', 18), this.widthOf(words.original, 'regular', 12))
    const textX = LEFT + CREST_WIDTH + 12
    const textWidth = RIGHT - titleWidth - 12 - textX
    const nameHeight = this.heightOf(school.name, 'display', 20, textWidth)
    const smallLines = [school.address, contact === '' ? null : contact].filter((text) => text !== null)
    const textHeight = nameHeight + smallLines.length * (1 + 12 * LINE_HEIGHT)
    const titleHeight = this.heightOf(words.title, 'display', 18, titleWidth) + 2 + 12 * LINE_HEIGHT
    const height = Math.max(CREST_HEIGHT, textHeight, titleHeight)

    this.crest(LEFT, this.y + (height - CREST_HEIGHT) / 2)

    let textY = this.y + (height - textHeight) / 2
    this.use('display', 20)
    this.doc.text(school.name, pt(textX), pt(textY), { width: pt(textWidth) })
    textY += nameHeight
    for (const text of smallLines) {
      textY += 1
      this.line([{ text: this.fit(text, 'regular', 12, textWidth) }], textX, textY, 12)
      textY += 12 * LINE_HEIGHT
    }

    const titleY = this.y + (height - titleHeight) / 2
    this.use('display', 18)
    this.doc.text(words.title, pt(RIGHT - titleWidth), pt(titleY), { width: pt(titleWidth), align: 'right' })
    this.line([{ text: words.original }], RIGHT - titleWidth, titleY + titleHeight - 12 * LINE_HEIGHT, 12, {
      align: 'right',
      width: titleWidth,
    })

    this.rule(LEFT, RIGHT, this.y + height + 10 + 1, 2, INK)
    this.y += height + 12
  }

  private details(): void {
    const { date } = this.snapshot
    this.y += GAP
    this.line([{ text: `${words.receiptNo} ` }, { text: this.snapshot.receiptNo, bold: true }], LEFT, this.y, 12)
    this.line(
      [
        { text: `${words.date} ` },
        { text: formatBsDateLong(parseBsDate(date.bs)), bold: true },
        { text: ` (${formatAdDate(date.ad)})` },
      ],
      LEFT,
      this.y,
      12,
      { align: 'right', width: WIDTH },
    )
    this.y += 12 * LINE_HEIGHT + 4
    this.line([{ text: `${words.fiscalYear} ${this.snapshot.fiscalYear}` }], LEFT, this.y, 12)
    this.line([{ text: `${words.session} ${this.snapshot.sessionName}` }], LEFT, this.y, 12, {
      align: 'right',
      width: WIDTH,
    })
    this.y += 12 * LINE_HEIGHT
  }

  private studentBox(): void {
    const { student, months } = this.snapshot
    const size = 12.5
    const lineHeight = size * LINE_HEIGHT
    const innerX = LEFT + 1 + 10
    const innerWidth = WIDTH - 2 - 20
    const column = (innerWidth - 16) / 2
    const rightX = innerX + column + 16
    // The design reads "Class 7 A": the word Class is the label and the rest is bold.
    const classValue = `${student.className.replace(/^Class\s+/i, '')} ${student.sectionName}`
    // Every month paid for is printed, so this row wraps instead of being shortened.
    const monthRuns: Run[] | null =
      months === null ? null : [{ text: `${words.forTheMonthsOf} ` }, { text: months, bold: true }]
    const monthsHeight = monthRuns === null ? 0 : 4 + this.measure(monthRuns, size, innerWidth)
    const height = 1 + 8 + 2 * lineHeight + 4 + monthsHeight + 8 + 1

    this.y += GAP
    this.doc
      .roundedRect(pt(LEFT + 0.5), pt(this.y + 0.5), pt(WIDTH - 1), pt(height - 1), pt(4))
      .lineWidth(pt(1))
      .strokeColor(INK)
      .stroke()
    let rowY = this.y + 1 + 8
    this.line(this.labelled(words.student, student.fullName, column, size), innerX, rowY, size)
    this.line(this.labelled(words.studentId, student.code, column, size), rightX, rowY, size)
    rowY += lineHeight + 4
    this.line(
      [
        { text: `${words.class} ` },
        { text: classValue, bold: true },
        { text: `, ${words.roll} ` },
        { text: String(student.rollNo), bold: true },
      ],
      innerX,
      rowY,
      size,
    )
    if (student.guardianName !== null) {
      this.line(this.labelled(words.guardian, student.guardianName, column, size), rightX, rowY, size)
    }
    if (monthRuns !== null) {
      rowY += lineHeight + 4
      this.paragraph(monthRuns, innerX, rowY, size, innerWidth)
    }
    this.y += height
  }

  private tableHeader(): void {
    const size = 12.5
    this.rule(LEFT, RIGHT, this.y + 0.5, 1, INK)
    const textY = this.y + 1 + ROW_PADDING
    this.line([{ text: words.serialNo, bold: true }], LEFT + CELL_PADDING, textY, size)
    this.line([{ text: words.particulars, bold: true }], LEFT + SERIAL_WIDTH + CELL_PADDING, textY, size)
    this.line([{ text: words.amountColumn, bold: true }], RIGHT - AMOUNT_WIDTH, textY, size, {
      align: 'right',
      width: AMOUNT_WIDTH - CELL_PADDING,
    })
    const bottom = textY + size * LINE_HEIGHT + ROW_PADDING
    this.rule(LEFT, RIGHT, bottom + 0.5, 1, INK)
    this.y = bottom + 1
  }

  // A receipt that needs a second page carries its number at the top of it.
  private newPage(): void {
    this.footer()
    this.doc.addPage()
    this.y = TOP
    this.line([{ text: `${words.receiptNo} ` }, { text: this.snapshot.receiptNo, bold: true }], LEFT, this.y, 12)
    this.y += 12 * LINE_HEIGHT
  }

  // Starts a new page when the next block would run into the footer.
  private makeRoom(height: number): boolean {
    if (this.y + height <= FOOTER_TOP - GAP) {
      return false
    }
    this.newPage()
    return true
  }

  private lines(): void {
    const size = 12.5
    const labelX = LEFT + SERIAL_WIDTH + CELL_PADDING
    const labelWidth = WIDTH - SERIAL_WIDTH - AMOUNT_WIDTH - 2 * CELL_PADDING
    this.y += GAP
    this.tableHeader()
    this.snapshot.lines.forEach((item, index) => {
      const textHeight = Math.max(size * LINE_HEIGHT, this.heightOf(item.label, 'regular', size, labelWidth))
      const height = ROW_PADDING + textHeight + ROW_PADDING + 1
      if (this.makeRoom(height)) {
        this.y += GAP
        this.tableHeader()
      }
      const textY = this.y + ROW_PADDING
      this.line([{ text: String(index + 1) }], LEFT + CELL_PADDING, textY, size)
      this.use('regular', size)
      this.doc.text(item.label, pt(labelX), pt(textY), { width: pt(labelWidth) })
      this.line([{ text: formatReceiptAmount(item.amount) }], RIGHT - AMOUNT_WIDTH, textY, size, {
        align: 'right',
        width: AMOUNT_WIDTH - CELL_PADDING,
      })
      this.rule(LEFT, RIGHT, this.y + height - 0.5, 1, RULE)
      this.y += height
    })
  }

  private totalsAndPayment(): void {
    const size = 12.5
    const lineHeight = size * LINE_HEIGHT
    const { totals, amountInWords, method, reference } = this.snapshot
    const inWords: Run[] = [{ text: `${words.inWords} ` }, { text: amountInWords, bold: true }]
    const paidBy: Run[] = [{ text: `${words.paidBy} ` }, { text: printEn.paymentMethods[method], bold: true }]
    if (reference !== null) {
      paidBy.push({ text: `, ${words.reference} ` }, { text: reference, bold: true })
    }
    paidBy.push({ text: `. ${words.thanks}` })
    const amountPaidHeight = 1 + 5 + 15 * LINE_HEIGHT + 5 + 1
    const totalsHeight = 3 * lineHeight + amountPaidHeight + 3 * 4
    this.makeRoom(
      GAP + totalsHeight + GAP + this.measure(inWords, size, WIDTH) + GAP + this.measure(paidBy, size, WIDTH),
    )

    const x = RIGHT - TOTALS_WIDTH
    const row = (label: string, amount: number, textSize: number, bold: boolean): void => {
      this.line([{ text: label, bold }], x, this.y, textSize)
      this.line([{ text: formatReceiptAmount(amount), bold }], x, this.y, textSize, { align: 'right', width: TOTALS_WIDTH })
    }
    this.y += GAP
    row(words.duesBefore, totals.duesBefore, size, false)
    this.y += lineHeight + 4
    row(words.discount, totals.discount, size, false)
    this.y += lineHeight + 4
    this.rule(x, RIGHT, this.y + 0.5, 1, INK)
    this.y += 1 + 5
    row(words.amountPaid, totals.amountPaid, 15, true)
    this.y += 15 * LINE_HEIGHT + 5
    this.rule(x, RIGHT, this.y + 0.5, 1, INK)
    this.y += 1 + 4
    row(words.balanceAfter, totals.balanceAfter, size, false)
    this.y += lineHeight

    this.y += GAP
    this.y += this.paragraph(inWords, LEFT, this.y, size, WIDTH)
    this.y += GAP
    this.y += this.paragraph(paidBy, LEFT, this.y, size, WIDTH)
  }

  private signatures(): void {
    if (this.y + GAP > SIGNATURES_TOP) {
      this.newPage()
    }
    const bottom = SIGNATURES_TOP + SIGNATURES_HEIGHT
    const lineY = bottom - (4 + 12 * LINE_HEIGHT)
    this.rule(LEFT, LEFT + SIGNATURE_LINE, lineY + 0.5, 1, INK)
    const receivedBy = `${words.receivedBy} ${this.snapshot.receivedBy}`
    this.line([{ text: this.fit(receivedBy, 'regular', 12, SIGNATURE_LINE) }], LEFT, lineY + 4, 12)
    this.rule(RIGHT - SIGNATURE_LINE, RIGHT, lineY + 0.5, 1, INK)
    this.line([{ text: words.signature }], RIGHT - SIGNATURE_LINE, lineY + 4, 12, {
      align: 'right',
      width: SIGNATURE_LINE,
    })

    const radius = SIGNATURES_HEIGHT / 2
    const centreX = PAGE_WIDTH / 2
    const centreY = SIGNATURES_TOP + radius
    this.doc
      .circle(pt(centreX), pt(centreY), pt(radius - 0.5))
      .lineWidth(pt(1))
      .dash(pt(3), { space: pt(3) })
      .strokeColor(STAMP_RING)
      .stroke()
      .undash()
    const [first, second] = words.stamp
    this.line([{ text: first }], centreX - radius, centreY - 12 * LINE_HEIGHT, 12, {
      align: 'center',
      width: SIGNATURES_HEIGHT,
      colour: STAMP_TEXT,
    })
    this.line([{ text: second }], centreX - radius, centreY, 12, {
      align: 'center',
      width: SIGNATURES_HEIGHT,
      colour: STAMP_TEXT,
    })
  }

  private footer(): void {
    const textY = FOOTER_TOP + 1 + 8
    this.rule(LEFT, RIGHT, FOOTER_TOP + 0.5, 1, RULE)
    this.line([{ text: words.keep }], LEFT, textY, 12, { colour: FOOTER_TEXT })
    this.line(
      [{ text: words.printed(formatKathmanduTime(this.print.printedAt), this.print.computer) }],
      LEFT,
      textY,
      12,
      { align: 'right', width: WIDTH, colour: FOOTER_TEXT },
    )
  }
}

// Draws a receipt from its snapshot alone, so a receipt never changes after it is issued.
export function renderReceipt(snapshot: ReceiptSnapshot, print: PrintDetails): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A5',
    margin: 0,
    info: { Title: `${words.title} ${snapshot.receiptNo}`, Author: snapshot.school.name, CreationDate: print.printedAt },
  })
  const chunks: Buffer[] = []
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => {
      resolve(Buffer.concat(chunks))
    })
    doc.on('error', reject)
  })
  registerFonts(doc)
  new ReceiptLayout(doc, snapshot, print).draw()
  doc.end()
  return done
}
