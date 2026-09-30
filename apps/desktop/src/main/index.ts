import { app, BrowserWindow, ipcMain, Menu, nativeImage, powerMonitor, screen, Tray } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { IpcChannels } from '../shared/protocol'
import { initPersistence } from './persistence'

const dirname = path.dirname(fileURLToPath(import.meta.url))

// 窗口位置记忆（轻量实现；M3 存档系统落地后并入 SaveFile.appState.windowBounds）。
// 无边框透明窗口若每次都落在系统默认位置，被其他窗口盖住时用户"找不到植物"。
const boundsPath = path.join(app.getPath('userData'), 'window-bounds.json')

function loadBounds(): { x?: number; y?: number } {
  try {
    const raw = JSON.parse(readFileSync(boundsPath, 'utf8')) as { x?: number; y?: number }
    // 防显示器变更后窗口落到屏幕外：钳回可见区域
    if (typeof raw.x === 'number' && typeof raw.y === 'number') {
      const onSomeDisplay = screen.getAllDisplays().some((d) => {
        const { x, y, width, height } = d.workArea
        return raw.x! >= x - 40 && raw.x! < x + width && raw.y! >= y - 40 && raw.y! < y + height
      })
      if (onSomeDisplay) return { x: raw.x, y: raw.y }
    }
  } catch {
    // 首次启动 / 文件损坏：用默认位置
  }
  return {}
}

function saveBounds(win: BrowserWindow): void {
  try {
    const [x, y] = win.getPosition()
    mkdirSync(path.dirname(boundsPath), { recursive: true })
    writeFileSync(boundsPath, JSON.stringify({ x: x ?? 0, y: y ?? 0 }))
  } catch {
    // 写失败不影响运行
  }
}

// 关键（02 §4 / A1）：Chromium 的原生窗口遮挡检测会把"被遮挡的透明置顶窗口"误判为
// 不可见并完全停止合成——桌面挂件会被"永久隐身"。禁用它；资源调度由渲染三态自己负责。
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')

// TODO(M0)：WindowController / TrayController / PowerMonitor 按职责拆分（07 §5），
// 随 A7/A8 落地再拆，先保持单文件最小可跑（05 §3）。

// A11：单实例锁——二次启动聚焦已有窗口（开机自启动随设置 UI 落地，默认关：总方案 §52 最少权限）
if (!app.requestSingleInstanceLock()) {
  app.quit()
}

let win: BrowserWindow | undefined
let tray: Tray | undefined

function createWindow(): BrowserWindow {
  const w = new BrowserWindow({
    width: 380,
    height: 460,
    ...loadBounds(),
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
      // 关键（02 §4）：挂件被完全遮挡时 Chromium 会冻结 RAF，窗口将永远透明不可见。
      // 资源调度由渲染三态状态机自己负责，不交给浏览器的遮挡启发式。
      backgroundThrottling: false,
    },
  })

  w.once('ready-to-show', () => {
    w.show()
    const pos = w.getPosition()
    console.info(`[main] window shown at (${pos[0]},${pos[1]}) size ${w.getBounds().width}x${w.getBounds().height}`)
  })
  // 拖动结束 / 关闭时记忆位置（拖动由 DragMove 高频调用 setPosition，用节流落盘）
  let saveTimer: NodeJS.Timeout | undefined
  const scheduleSave = (): void => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = undefined
      if (!w.isDestroyed()) saveBounds(w)
    }, 500)
  }
  w.on('moved', scheduleSave)
  w.on('close', () => {
    if (saveTimer) clearTimeout(saveTimer)
    if (!w.isDestroyed()) saveBounds(w)
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void w.loadURL(devUrl)
  } else {
    void w.loadFile(path.join(dirname, '../renderer/index.html'))
  }
  return w
}

/** A6：托盘（图标为运行时生成的 16×16 纯色位图，正式图标属发布资产；Win11 默认收进溢出区） */
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

// A3：动态穿透——forward 让穿透期间指针事件继续回流，命中检测才能工作
ipcMain.on(IpcChannels.SetIgnoreMouseEvents, (_event, ignore: unknown) => {
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
  if (win) saveBounds(win) // 拖动结束立即记忆位置
})

ipcMain.on(IpcChannels.SetBounds, (_event, w: unknown, h: unknown) => {
  if (typeof w === 'number' && typeof h === 'number' && win) {
    win.setBounds({ width: Math.round(w), height: Math.round(h) })
  }
})

ipcMain.on(IpcChannels.FocusWindow, () => {
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

void app.whenReady().then(() => {
  initPersistence()
  app.on('second-instance', () => win?.show())
  win = createWindow()
  createTray()

  // A12：休眠/唤醒钩子（02 §1.4）——M0 只验证事件可达，时钟补算由 M3 的 SimulationClock 消费
  powerMonitor.on('suspend', () => console.info('[power] suspend'))
  powerMonitor.on('resume', () => console.info('[power] resume → 时间增量交由 SimulationClock 补算'))

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) win = createWindow()
  })
})

// 退出前通知 renderer 落盘（02 $6.2）；2s 兜底强退
let flushRequested = false
app.on('before-quit', (e) => {
  if (flushRequested || !win || win.isDestroyed()) return
  e.preventDefault()
  flushRequested = true
  win.webContents.send('app:flush-request')
  setTimeout(() => app.exit(0), 2000)
})
ipcMain.once('app:flush-done', () => {
  if (flushRequested) app.exit(0)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
