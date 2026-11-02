import { join } from 'node:path'

import { app, BrowserWindow, dialog, type WebContents } from 'electron'

import type { CloseWarning, StartAt } from '../bridge.ts'
import { mayClose, STAY } from './close-warning.ts'
import { registerBridge } from './ipc.ts'
import { type SettingsStore, settingsStore } from './settings.ts'

// The same colours as the chrome-accountant and paper tokens, so a window never flashes white.
const SPLASH_BACKGROUND = '#0F3A31'
const APP_BACKGROUND = '#F2F4F3'

// In development (`pnpm dev`) one machine is both computers. With no address saved, the app uses
// this machine's own server, which always allows itself, so setup is skipped. A production build
// has no such address, so the installed app always asks.
const DEV_SERVER_URL = import.meta.env.DEV ? 'http://127.0.0.1:3100' : null

function withDevServer(store: SettingsStore, serverUrl: string): SettingsStore {
  return {
    ...store,
    read: async () => {
      const settings = await store.read()
      return { ...settings, serverUrl: settings.serverUrl ?? serverUrl }
    },
  }
}

let splash: BrowserWindow | null = null
let appWindow: BrowserWindow | null = null
// Set by the renderer while a payment Computer 1 has not confirmed is waiting.
let closeWarning: CloseWarning | null = null

function newWindow(options: Electron.BrowserWindowConstructorOptions): BrowserWindow {
  const window = new BrowserWindow({
    ...options,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  // Nothing but the app itself opens in its windows.
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => {
    if (event.url !== window.webContents.getURL()) {
      event.preventDefault()
    }
  })
  return window
}

// Each window loads the one renderer; `view` says which part of it to show.
function load(window: BrowserWindow, query: Record<string, string>): void {
  const devServerUrl = process.env.ELECTRON_RENDERER_URL
  if (devServerUrl) {
    void window.loadURL(`${devServerUrl}?${new URLSearchParams(query).toString()}`)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'), { query })
  }
}

function openSplash(): void {
  const window = newWindow({
    width: 640,
    height: 400,
    frame: false,
    resizable: false,
    maximizable: false,
    center: true,
    backgroundColor: SPLASH_BACKGROUND,
  })
  window.once('ready-to-show', () => window.show())
  load(window, { view: 'splash' })
  splash = window
}

// The splash asks for this once it knows where the app starts. The splash closes only once the
// app window is showing, so there is always a window open.
function finishStartup(startAt: StartAt, from: WebContents): void {
  if (splash === null || from !== splash.webContents || appWindow !== null) {
    return
  }
  const window = newWindow({ width: 1366, height: 768, backgroundColor: APP_BACKGROUND })
  window.on('close', (event) => {
    // Stay is button 0 (STAY) and Close anyway button 1 (CLOSE).
    const ask = (warning: CloseWarning): number =>
      dialog.showMessageBoxSync(window, {
        type: 'warning',
        message: warning.message,
        buttons: [warning.stay, warning.close],
        defaultId: STAY,
        cancelId: STAY,
        noLink: true,
      })
    if (mayClose(closeWarning, ask)) {
      closeWarning = null
    } else {
      event.preventDefault()
    }
  })
  window.once('ready-to-show', () => {
    window.show()
    splash?.close()
    splash = null
  })
  load(window, { view: 'app', startAt })
  appWindow = window
}

void app.whenReady().then(() => {
  const settings = settingsStore(app.getPath('userData'))
  registerBridge(DEV_SERVER_URL === null ? settings : withDevServer(settings, DEV_SERVER_URL), finishStartup, (warning) => {
    closeWarning = warning
  })
  openSplash()
})

app.on('window-all-closed', () => {
  app.quit()
})
