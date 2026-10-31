import { createRequire } from 'node:module'

import { amountInWords, BS_MONTH_NAMES, formatReceiptAmount, printEn } from '@mikey/shared'
import { describe, expect, it } from 'vitest'

import { FONT_NAMES, readFont } from './fonts.ts'

// fontkit is the library PDFKit embeds fonts with; this loads the same copy PDFKit uses.
interface FontkitFont {
  hasGlyphForCodePoint(codePoint: number): boolean
}
const fromPdfkit = createRequire(createRequire(import.meta.url).resolve('pdfkit'))
const fontkit = fromPdfkit('fontkit') as { create(data: Buffer): FontkitFont }

function stringsIn(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value]
  }
  if (value !== null && typeof value === 'object') {
    return Object.values(value).flatMap(stringsIn)
  }
  return []
}

// The receipt's own words, every month name and amount in words, any typed text (names, school
// details, references are typed on an English keyboard) and the ellipsis that shortens long names.
const typed = Array.from({ length: 0x7e - 0x20 + 1 }, (_unused, index) => String.fromCodePoint(0x20 + index)).join('')
const printed = [
  typed,
  '…',
  ...stringsIn(printEn),
  printEn.document.printed('10:58 AM', 2),
  printEn.document.copy(12),
  ...BS_MONTH_NAMES,
  amountInWords(123_456_789_50),
  formatReceiptAmount(123_456_789_50),
].join('')
const characters = [...new Set(printed)]

describe('receipt fonts', () => {
  it.each(FONT_NAMES)('%s has a glyph for every character a receipt can print', (name) => {
    const font = fontkit.create(readFont(name))
    const missing = characters.filter((character) => !font.hasGlyphForCodePoint(character.codePointAt(0) ?? 0))
    expect(missing).toEqual([])
  })

  // The check above can see a missing glyph: these fonts have no Devanagari, so a name typed in
  // Nepali would print as boxes (a Nepali interface is open question Q10).
  it('notices a character the fonts do not have', () => {
    expect(fontkit.create(readFont('regular')).hasGlyphForCodePoint(0x0915)).toBe(false)
  })
})
