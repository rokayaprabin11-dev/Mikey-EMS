import { join } from 'node:path'

import { app, BrowserWindow } from 'electron'

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1366,
    height: 768,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  window.once('ready-to-show', () => window.show())

  const devServerUrl = process.env.ELECTRON_RENDERER_URL
  if (devServerUrl) {
    void window.loadURL(devServerUrl)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

void app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  app.quit()
})
