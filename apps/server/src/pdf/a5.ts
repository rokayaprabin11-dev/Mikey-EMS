import { formatKathmanduTime, printEn } from '@mikey/shared'

import { INK, LINE_HEIGHT, PdfLayout, pt, RULE } from './layout.ts'

const words = printEn.document

// Measurements are from the A5 receipt in the Accountant design, which is 559 × 794 CSS pixels.
export const PAGE_WIDTH = 559
export const PAGE_HEIGHT = 794
export const LEFT = 42
export const RIGHT = PAGE_WIDTH - 42
export const WIDTH = RIGHT - LEFT
export const TOP = 40
export const GAP = 12
export const FOOTER_TOP = PAGE_HEIGHT - 36 - (1 + 8 + 12 * LINE_HEIGHT)
const CREST_WIDTH = 46
const CREST_HEIGHT = 51
const FOOTER_TEXT = '#3C4752'

export interface SchoolHeading {
  name: string
  address: string | null
  phone: string | null
  pan: string | null
}

// `copy` is the print number of a copy, or null for the original.
export interface PrintDetails {
  printedAt: Date
  computer: 1 | 2
  copy: number | null
}

// A page in the receipt's style: the school beside its crest, the document's title and whether
// this print is the original or a copy, and a footer saying when and where it was printed.
export class A5Layout extends PdfLayout {
  protected y = TOP

  protected header(school: SchoolHeading, title: string, copy: number | null): void {
    const contact = [
      school.phone === null ? null : `${words.phone} ${school.phone}`,
      school.pan === null ? null : `${words.pan} ${school.pan}`,
    ]
      .filter((part) => part !== null)
      .join('   ')
    const which = copy === null ? words.original : words.copy(copy)
    const titleWidth = Math.max(this.widthOf(title, 'display', 18), this.widthOf(which, 'regular', 12))
    const textX = LEFT + CREST_WIDTH + 12
    const textWidth = RIGHT - titleWidth - 12 - textX
    const nameHeight = this.heightOf(school.name, 'display', 20, textWidth)
    const smallLines = [school.address, contact === '' ? null : contact].filter((text) => text !== null)
    const textHeight = nameHeight + smallLines.length * (1 + 12 * LINE_HEIGHT)
    const titleHeight = this.heightOf(title, 'display', 18, titleWidth) + 2 + 12 * LINE_HEIGHT
    const height = Math.max(CREST_HEIGHT, textHeight, titleHeight)

    this.crest(LEFT, this.y + (height - CREST_HEIGHT) / 2, CREST_WIDTH)

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
    this.doc.text(title, pt(RIGHT - titleWidth), pt(titleY), { width: pt(titleWidth), align: 'right' })
    this.line([{ text: which }], RIGHT - titleWidth, titleY + titleHeight - 12 * LINE_HEIGHT, 12, {
      align: 'right',
      width: titleWidth,
    })

    this.rule(LEFT, RIGHT, this.y + height + 10 + 1, 2, INK)
    this.y += height + 12
  }

  protected footer(left: string, print: PrintDetails): void {
    const textY = FOOTER_TOP + 1 + 8
    this.rule(LEFT, RIGHT, FOOTER_TOP + 0.5, 1, RULE)
    this.line([{ text: left }], LEFT, textY, 12, { colour: FOOTER_TEXT })
    this.line([{ text: words.printed(formatKathmanduTime(print.printedAt), print.computer) }], LEFT, textY, 12, {
      align: 'right',
      width: WIDTH,
      colour: FOOTER_TEXT,
    })
  }
}
