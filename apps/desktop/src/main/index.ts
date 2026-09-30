import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, Tray } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { IpcChannels } from '../shared/protocol'

const dirname = path.dirname(fileURLToPath(import.meta.url))

// TODO(M0)：WindowController / TrayController / PowerMonitor 按职责拆分（07 §5），
// 随 A7/A8/A12 落地再拆，先保持单文件最小可跑（05 §3）。

let win: BrowserWindow | undefined
let tray: Tray | undefined

function createWindow(): BrowserWindow {
  const w = new BrowserWindow({
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

  w.once('ready-to-show', () => w.show())

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void w.loadURL(devUrl)
  } else {
    void w.loadFile(path.join(dirname, '../renderer/index.html'))
  }
  return w
}

/** A6：托盘（图标为运行时生成的 16×16 纯色位图，正式图标属发布资产） */
function createTray(): void {
  const size = 16
  const buf = Buffer.alloc(size * size * 4)
  for (let i = 0; i < size * size; i++) {
    buf[i * 4 + 0] = 0x7b // B
    buf[i * 4 + 1] = 0xa8 // G
    buf[i * 4 + 2] = 0x7d // R
    buf[i * 4 + 3] = 0xff
  }
  tray = new Tray(nativeImage.createFromBitmap(buf, { width: size, height: size }))
  tray.setToolTip('a little succulent')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示', click: () => win?.show() },
      { type: 'separator' },
      { label: '退出', click: () => app.quit() },
    ]),
  )
  tray.on('click', () => win?.show())
}

ipcMain.on(IpcChannels.SetIgnoreMouseEvents, (_event, ignore: unknown) => {
  // forward: 穿透期间仍把指针事件转发给 renderer，命中检测才能持续工作（A3）
  if (typeof ignore === 'boolean') win?.setIgnoreMouseEvents(ignore, { forward: true })
})

// A4：拖动用屏幕坐标锚定（光标 − 抓取偏移），而不是 renderer 相对位移——
// 后者会随窗口追上光标而自我抵消（实测表现为"只跟上一半速度"）
let dragOffset: { x: number; y: number } | undefined

ipcMain.on(IpcChannels.DragStart, () => {
  if (!win) return
  const cursor = screen.getCursorScreenPoint()
  const pos = win.getPosition()
  dragOffset = { x: cursor.x - (pos[0] ?? 0), y: cursor.y - (pos[1] ?? 0) }
})

ipcMain.on(IpcChannels.DragMove, () => {
  if (!win || !dragOffset) return
  const cursor = screen.getCursorScreenPoint()
  win.setPosition(cursor.x - dragOffset.x, cursor.y - dragOffset.y)
})

ipcMain.on(IpcChannels.DragEnd, () => {
  dragOffset = undefined
})

void app.whenReady().then(() => {
  win = createWindow()
  createTray()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) win = createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
