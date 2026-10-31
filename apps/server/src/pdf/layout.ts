import PDFDocument from 'pdfkit'

import { type FontName, registerFonts } from './fonts.ts'

// Measurements come from the designs, in CSS pixels. A CSS pixel is 0.75 PDF points.
const PT_PER_PX = 0.75

export const LINE_HEIGHT = 1.3

export const INK = '#111A22'
export const RULE = '#C9D1CE'
const CREST = '#8C1D2F'

// The placeholder crest from the design, drawn in a 40 × 44 box.
const CREST_SHIELD = 'M20 2 L37 8 V22 C37 32 29 39 20 42 C11 39 3 32 3 22 V8 Z'
const CREST_LETTER = 'M11 30 V14 L20 24 L29 14 V30'

export interface Run {
  text: string
  bold?: boolean
}

export interface LineOptions {
  align?: 'left' | 'right' | 'center'
  width?: number
  colour?: string
}

export function pt(px: number): number {
  return px * PT_PER_PX
}

// Drawing helpers for every document the server prints. Everything is measured in CSS pixels.
export class PdfLayout {
  protected readonly doc: PDFKit.PDFDocument

  constructor(doc: PDFKit.PDFDocument) {
    this.doc = doc
  }

  protected use(font: FontName, size: number, colour = INK): void {
    this.doc.font(font).fontSize(pt(size)).fillColor(colour)
  }

  protected widthOf(text: string, font: FontName, size: number): number {
    this.doc.font(font).fontSize(pt(size))
    return this.doc.widthOfString(text) / PT_PER_PX
  }

  protected heightOf(text: string, font: FontName, size: number, width: number): number {
    this.doc.font(font).fontSize(pt(size))
    return this.doc.heightOfString(text, { width: pt(width) }) / PT_PER_PX
  }

  private fontOf(run: Run): FontName {
    return run.bold === true ? 'bold' : 'regular'
  }

  // Shortens text with an ellipsis until it fits the width.
  protected fit(text: string, font: FontName, size: number, width: number): string {
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
  protected line(runs: readonly Run[], x: number, y: number, size: number, options: LineOptions = {}): void {
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
  protected measure(runs: readonly Run[], size: number, width: number): number {
    return this.heightOf(runs.map((run) => run.text).join(''), 'bold', size, width)
  }

  protected paragraph(runs: readonly Run[], x: number, y: number, size: number, width: number): number {
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

  protected rule(from: number, to: number, y: number, thickness: number, colour: string): void {
    this.doc.moveTo(pt(from), pt(y)).lineTo(pt(to), pt(y)).lineWidth(pt(thickness)).strokeColor(colour).stroke()
  }

  // A label followed by its value in bold, the value shortened to fit the width.
  protected labelled(label: string, value: string, width: number, size: number): Run[] {
    const room = width - this.widthOf(`${label} `, 'regular', size)
    return [{ text: `${label} ` }, { text: this.fit(value, 'bold', size, room), bold: true }]
  }

  protected crest(x: number, y: number, width: number): void {
    this.doc.save().translate(pt(x), pt(y)).scale(pt(width) / 40)
    this.doc.path(CREST_SHIELD).fill(CREST)
    this.doc.path(CREST_LETTER).lineWidth(3).lineJoin('round').strokeColor('#FFFFFF').stroke()
    this.doc.restore()
  }
}

// Makes a PDF with the bundled fonts and returns its bytes.
export function renderPdf(options: PDFKit.PDFDocumentOptions, draw: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  const doc = new PDFDocument({ margin: 0, ...options })
  const chunks: Buffer[] = []
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => {
      resolve(Buffer.concat(chunks))
    })
    doc.on('error', reject)
  })
  registerFonts(doc)
  draw(doc)
  doc.end()
  return done
}
