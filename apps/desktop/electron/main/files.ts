import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { app, type BrowserWindow, dialog } from 'electron'

import { en } from '../../src/i18n/en.ts'
import type { SaveResult } from '../bridge.ts'

// The name the screen suggests, such as "Fee collection 2083-07-01 to 2083-07-15.pdf".
export const SUGGESTED_NAME = /^[\w\- .,()]{1,120}\.(pdf|xlsx)$/

// Asks where to save a PDF or a workbook, starting in Documents, and saves it there.
export async function savePdfOrExcel(window: BrowserWindow, bytes: Uint8Array, suggestedName: string): Promise<SaveResult> {
  const pdf = suggestedName.endsWith('.pdf')
  const choice = await dialog.showSaveDialog(window, {
    defaultPath: join(app.getPath('documents'), suggestedName),
    filters: [pdf ? { name: en.files.pdf, extensions: ['pdf'] } : { name: en.files.excel, extensions: ['xlsx'] }],
  })
  if (choice.canceled || choice.filePath === '') {
    return { saved: false }
  }
  await writeFile(choice.filePath, bytes)
  return { saved: true }
}
