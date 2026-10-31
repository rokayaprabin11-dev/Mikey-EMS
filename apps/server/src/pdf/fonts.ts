import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const localRequire = createRequire(import.meta.url)

// The fonts the desktop app bundles: IBM Plex Sans for text, Anek Latin for headings. PDFs use
// the WOFF files, because fontkit fails to subset some glyphs from the WOFF2 ones.
const FILES = {
  regular: '@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff',
  bold: '@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff',
  display: '@fontsource/anek-latin/files/anek-latin-latin-700-normal.woff',
} as const

export type FontName = keyof typeof FILES

let loaded: Record<FontName, Buffer> | undefined

export function registerFonts(doc: PDFKit.PDFDocument): void {
  loaded ??= {
    regular: readFileSync(localRequire.resolve(FILES.regular)),
    bold: readFileSync(localRequire.resolve(FILES.bold)),
    display: readFileSync(localRequire.resolve(FILES.display)),
  }
  for (const [name, data] of Object.entries(loaded)) {
    doc.registerFont(name, data)
  }
}
