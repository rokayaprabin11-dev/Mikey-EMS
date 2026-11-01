import { contextBridge, ipcRenderer } from 'electron'

import { type Bridge, CHANNELS } from '../bridge.ts'

// The main process checks every argument and answers with the types in bridge.ts.
function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args) as Promise<T>
}

const bridge: Bridge = {
  appVersion: () => invoke(CHANNELS.appVersion),
  computerName: () => invoke(CHANNELS.computerName),
  getServerUrl: () => invoke(CHANNELS.getServerUrl),
  setServerUrl: (serverUrl) => invoke(CHANNELS.setServerUrl, serverUrl),
  request: (request) => invoke(CHANNELS.request, request),
  testServer: (serverUrl) => invoke(CHANNELS.testServer, serverUrl),
  listPrinters: () => invoke(CHANNELS.listPrinters),
  getPrinter: () => invoke(CHANNELS.getPrinter),
  setPrinter: (printer) => invoke(CHANNELS.setPrinter, printer),
  printPdf: (bytes, printer) => invoke(CHANNELS.printPdf, bytes, printer),
  savePdfOrExcel: (bytes, suggestedName) => invoke(CHANNELS.savePdfOrExcel, bytes, suggestedName),
  finishStartup: (startAt) => invoke(CHANNELS.finishStartup, startAt),
}

contextBridge.exposeInMainWorld('mikey', bridge)
