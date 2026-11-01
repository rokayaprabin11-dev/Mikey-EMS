// Everything the renderer may ask of the main process, as the preload exposes it on
// `window.mikey` (docs/ARCHITECTURE.md, Desktop app). The preload, the main process and the
// renderer all use this one list.

// A request to Computer 1. The path is under /api/v1 and carries its query string.
export interface ServerRequest {
  method: 'GET' | 'POST'
  path: string
  token: string | null
  // JSON text, for a POST that sends a body.
  body: string | null
  timeoutMs: number
}

// `reached: false` means no reply came back at all: the address is wrong, Computer 1 is off, the
// network is down, or the reply took longer than the time allowed. `reason` is for "Copy error
// details", never for the screen.
export type ServerReply =
  | { reached: true; status: number; contentType: string; body: Uint8Array }
  | { reached: false; reason: string }

export interface Printer {
  // The name Windows knows the printer by, which a print is sent to.
  name: string
  displayName: string
  description: string
}

// Receipts print on A5 (DOMAIN_RULES §5, default paper), the only paper this version prints on.
export type Paper = 'A5'

export interface ReceiptPrinter {
  name: string
  paper: Paper
}

export type PrintResult = { printed: true } | { printed: false; reason: string }

export type SaveResult = { saved: true } | { saved: false }

// Where the app window starts once the splash is done.
export type StartAt = 'setup' | 'sign-in'

export interface Bridge {
  appVersion(): Promise<string>
  // This computer's Windows name, sent with a request to connect.
  computerName(): Promise<string>
  getServerUrl(): Promise<string | null>
  setServerUrl(serverUrl: string): Promise<void>
  // Sends a request to the saved server address.
  request(request: ServerRequest): Promise<ServerReply>
  // Asks a typed address for GET /health, before it is saved.
  testServer(serverUrl: string): Promise<ServerReply>
  listPrinters(): Promise<Printer[]>
  getPrinter(): Promise<ReceiptPrinter | null>
  setPrinter(printer: ReceiptPrinter): Promise<void>
  // Prints on the chosen printer without asking; with no printer chosen, or when that fails, it
  // opens the Windows print window instead.
  printPdf(bytes: Uint8Array, printer: ReceiptPrinter | null): Promise<PrintResult>
  savePdfOrExcel(bytes: Uint8Array, suggestedName: string): Promise<SaveResult>
  // Closes the splash and opens the app window.
  finishStartup(startAt: StartAt): Promise<void>
}

export const CHANNELS = {
  appVersion: 'app:version',
  computerName: 'app:computer-name',
  getServerUrl: 'settings:get-server-url',
  setServerUrl: 'settings:set-server-url',
  request: 'server:request',
  testServer: 'server:test',
  listPrinters: 'printing:list',
  getPrinter: 'settings:get-printer',
  setPrinter: 'settings:set-printer',
  printPdf: 'printing:print',
  savePdfOrExcel: 'files:save',
  finishStartup: 'app:finish-startup',
} as const satisfies Record<keyof Bridge, string>
