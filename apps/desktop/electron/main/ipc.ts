import { hostname } from 'node:os'

import { app, BrowserWindow, ipcMain, type WebContents } from 'electron'
import { z } from 'zod'

import { CHANNELS, type CloseWarning, type StartAt } from '../bridge.ts'
import { serverUrlFrom } from '../server-address.ts'
import { SUGGESTED_NAME, savePdfOrExcel } from './files.ts'
import { listPrinters, printOriginal, printPdf } from './printing.ts'
import { sendToServer, serverRequestSchema } from './server.ts'
import type { SettingsStore } from './settings.ts'

// Everything the renderer sends is checked here before it is used.
const serverUrlSchema = z.string().refine((value) => serverUrlFrom(value) === value)
const printerSchema = z.object({ name: z.string().min(1), paper: z.literal('A5') })
const bytesSchema = z.instanceof(Uint8Array)
const startAtSchema = z.enum(['setup', 'get-allowed', 'sign-in']) satisfies z.ZodType<StartAt>
const closeWarningSchema = z
  .object({ message: z.string().min(1).max(500), stay: z.string().min(1).max(40), close: z.string().min(1).max(40) })
  .nullable() satisfies z.ZodType<CloseWarning | null>

const TEST_TIMEOUT_MS = 5_000

function windowOf(contents: WebContents): BrowserWindow {
  const window = BrowserWindow.fromWebContents(contents)
  if (window === null) {
    throw new Error('The request did not come from an app window.')
  }
  return window
}

export function registerBridge(
  settings: SettingsStore,
  finishStartup: (startAt: StartAt, from: WebContents) => void,
  setCloseWarning: (warning: CloseWarning | null) => void,
): void {
  ipcMain.handle(CHANNELS.appVersion, () => app.getVersion())
  ipcMain.handle(CHANNELS.computerName, () => hostname())
  ipcMain.handle(CHANNELS.getServerUrl, async () => (await settings.read()).serverUrl)
  ipcMain.handle(CHANNELS.setServerUrl, (_event, serverUrl) => settings.update({ serverUrl: serverUrlSchema.parse(serverUrl) }))
  ipcMain.handle(CHANNELS.request, async (_event, request) => {
    const { serverUrl } = await settings.read()
    if (serverUrl === null) {
      throw new Error('No server address is saved yet, so there is nowhere to send the request.')
    }
    return sendToServer(serverUrl, serverRequestSchema.parse(request))
  })
  ipcMain.handle(CHANNELS.testServer, (_event, serverUrl) =>
    sendToServer(serverUrlSchema.parse(serverUrl), {
      method: 'GET',
      path: '/health',
      token: null,
      body: null,
      timeoutMs: TEST_TIMEOUT_MS,
    }),
  )
  ipcMain.handle(CHANNELS.listPrinters, (event) => listPrinters(event.sender))
  ipcMain.handle(CHANNELS.getPrinter, async () => (await settings.read()).printer)
  ipcMain.handle(CHANNELS.setPrinter, (_event, printer) => settings.update({ printer: printerSchema.parse(printer) }))
  ipcMain.handle(CHANNELS.printPdf, (_event, bytes, printer) =>
    printPdf(bytesSchema.parse(bytes), printerSchema.nullable().parse(printer)),
  )
  ipcMain.handle(CHANNELS.printOriginal, (_event, bytes, printer) => printOriginal(bytesSchema.parse(bytes), printerSchema.parse(printer)))
  ipcMain.handle(CHANNELS.savePdfOrExcel, (event, bytes, suggestedName) =>
    savePdfOrExcel(windowOf(event.sender), bytesSchema.parse(bytes), z.string().regex(SUGGESTED_NAME).parse(suggestedName)),
  )
  ipcMain.handle(CHANNELS.finishStartup, (event, startAt) => finishStartup(startAtSchema.parse(startAt), event.sender))
  ipcMain.handle(CHANNELS.setCloseWarning, (_event, warning) => setCloseWarning(closeWarningSchema.parse(warning)))
}
