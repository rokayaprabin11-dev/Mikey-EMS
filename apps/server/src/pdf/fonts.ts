import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const localRequire = createRequire(import.meta.url)

export const FONT_NAMES = ['regular', 'bold', 'display'] as const

export type FontName = (typeof FONT_NAMES)[number]

// The fonts the desktop app bundles: IBM Plex Sans for text, Anek Latin for headings. PDFs use
// the WOFF files, because fontkit fails to subset some glyphs from the WOFF2 ones.
const FILES: Record<FontName, string> = {
  regular: '@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff',
  bold: '@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff',
  display: '@fontsource/anek-latin/files/anek-latin-latin-700-normal.woff',
}

const loaded = new Map<FontName, Buffer>()

export function readFont(name: FontName): Buffer {
  let data = loaded.get(name)
  if (data === undefined) {
    data = readFileSync(localRequire.resolve(FILES[name]))
    loaded.set(name, data)
  }
  return data
}

export function registerFonts(doc: PDFKit.PDFDocument): void {
  for (const name of FONT_NAMES) {
    doc.registerFont(name, readFont(name))
  }
}
