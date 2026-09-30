import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dirname = path.dirname(fileURLToPath(import.meta.url))

// TODO(M0)：WindowController / TrayController / PowerMonitor 按职责拆分（07 §5），
// 随 A3～A6 落地再拆，先保持单文件最小可跑（05 §3 A1）。
function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 380,
    height: 460,
    transparent: true,
    frame: false,
    hasShadow: false,
    resizable: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: path.join(dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win.once('ready-to-show', () => win.show())

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void win.loadURL(devUrl)
  } else {
    void win.loadFile(path.join(dirname, '../renderer/index.html'))
  }
  return win
}

void app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
