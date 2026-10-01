import { app, BrowserWindow, ipcMain, Menu, nativeImage, net, protocol, powerMonitor, screen, Tray } from 'electron'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { IpcChannels, type AppSettings } from '../shared/protocol'
import { initPersistence } from './persistence'
import { getSettings, initSettings, updateSettings } from './settings'
import { startFullscreenWatcher } from './fullscreen'
import { initAutoUpdater, registerUpdateIpc } from './updater'
import { getSteam } from './steam'

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

// 打包版 renderer 走 app:// 自定义协议：file:// 下 <script type="module"> 会被 CORS 拦截，
// 页面全空（打包版实测全透明截图）。standard+secure 才能以相对路径加载 ESM 产物。
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
])

// A11：单实例锁——二次启动聚焦已有窗口（开机自启动随设置 UI 落地，默认关：总方案 §52 最少权限）
if (!app.requestSingleInstanceLock()) {
  app.quit()
}

let win: BrowserWindow | undefined
let tray: Tray | undefined

function createWindow(): BrowserWindow {
  const settings = getSettings()
  const w = new BrowserWindow({
    width: Math.round(380 * settings.windowScale),
    height: Math.round(460 * settings.windowScale),
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

  w.setOpacity(settings.opacity)
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

  // M5-5 拍照：下载静默落盘到系统下载目录（挂件弹保存框很突兀），同名自动追加序号
  w.webContents.session.on('will-download', (_event, item) => {
    const dir = app.getPath('downloads')
    const ext = path.extname(item.getFilename())
    const stem = path.basename(item.getFilename(), ext)
    let file = path.join(dir, `${stem}${ext}`)
    for (let n = 1; existsSync(file); n++) {
      file = path.join(dir, `${stem} (${n})${ext}`)
    }
    item.setSavePath(file)
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void w.loadURL(devUrl)
  } else {
    void w.loadURL('app://renderer/index.html')
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
      { label: '设置', click: () => win?.webContents.send(IpcChannels.AppOpenSettings) },
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

// M7-3 用户设置：读 + 部分更新（主进程应用 + 原子落盘 + 推送 renderer）
ipcMain.handle(IpcChannels.SettingsGet, () => getSettings())
ipcMain.handle(IpcChannels.SettingsSet, (_event, patch: unknown) => {
  const next = updateSettings(win, (patch ?? {}) as Partial<AppSettings>)
  win?.webContents.send(IpcChannels.SettingsChanged, next)
  return next
})

void app.whenReady().then(() => {
  // app:// → out/renderer/ 静态文件
  const rendererDir = path.join(dirname, '../renderer')
  protocol.handle('app', (request) => {
    const u = new URL(request.url)
    let rel = decodeURIComponent(u.pathname)
    if (rel === '/' || rel === '') rel = '/index.html'
    return net.fetch(pathToFileURL(path.join(rendererDir, rel)).toString())
  })

  const saveDir = initPersistence()
  initSettings(saveDir)
  registerUpdateIpc()
  // M6-4/M7：成就解锁 → Steamworks 激活（本地持久化在 renderer 的 checkpoint appState 里）
  ipcMain.on(IpcChannels.AchievementUnlock, (_event, id: unknown) => {
    if (typeof id === 'string' && id.length > 0) getSteam()?.unlockAchievement(id)
  })

  // A13：全屏应用检测 -> 强制 DeepIdle（渲染三态，02 §4）
  startFullscreenWatcher(
    () => win,
    (fs) => win?.webContents.send(IpcChannels.FullscreenChanged, fs),
  )
  app.on('second-instance', () => win?.show())
  win = createWindow()
  createTray()
  initAutoUpdater(() => win)

  // DEV 自检：SUCCULENT_SHOT=plain|journal|settings|photo —— 启动数秒后 capturePage 截图并退出。
  // 截图只写系统临时目录（隐私红线：永不入库）；journal/settings/photo 会先派发对应按键再截。
  const shotMode = process.env['SUCCULENT_SHOT']
  if (shotMode) {
    setTimeout(() => {
      if (!win || win.isDestroyed()) return
      if (shotMode === 'sheet') {
        // 联系表批量出图（DEV；Shift+C 挂载联系表）→ 大视口截图
        win.setBounds({ width: 1440, height: 1000 })
        void win.webContents.executeJavaScript(
          "window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyC', shiftKey: true }))",
        )
      }
      const key =
        shotMode === 'journal' ? 'KeyJ' : shotMode === 'settings' ? 'KeyS' : shotMode === 'photo' ? 'KeyP' : null
      if (key) {
        void win.webContents.executeJavaScript(
          `window.dispatchEvent(new KeyboardEvent('keydown', { code: '${key}', shiftKey: ${shotMode === 'photo'} }))`,
        )
      }
      setTimeout(() => {
        if (!win || win.isDestroyed()) return
        void win.webContents
          .capturePage()
          .then((img) => {
            const out = path.join(os.tmpdir(), `succulent-shot-${shotMode}-${Date.now()}.png`)
            writeFileSync(out, img.toPNG())
            console.info(`[shot] saved: ${out}`)
          })
          .finally(() => app.quit())
      }, shotMode === 'sheet' ? 5000 : key ? 1500 : 0)
    }, 7000)
  }

  // M7-4 素材导出：SUCCULENT_TIMELAPSE=<天数> —— 每模拟日一帧（postMessage 推进 → 截图），
  // 帧序列写系统临时目录 timelapse/（隐私红线：永不入库），完成后自动退出。
  const timelapseDays = Number.parseInt(process.env['SUCCULENT_TIMELAPSE'] ?? '', 10)
  if (Number.isFinite(timelapseDays) && timelapseDays > 0) {
    const dir = path.join(os.tmpdir(), 'succulent-timelapse')
    mkdirSync(dir, { recursive: true })
    let day = 0
    const step = (): void => {
      if (day >= timelapseDays || !win || win.isDestroyed()) {
        console.info(`[timelapse] done: ${day} frames in ${dir}`)
        app.quit()
        return
      }
      win.webContents.postMessage('succulent:advance-day', '*')
      setTimeout(() => {
        if (!win || win.isDestroyed()) return
        void win.webContents
          .capturePage()
          .then((img) => {
            writeFileSync(path.join(dir, `frame-${String(day).padStart(4, '0')}.png`), img.toPNG())
          })
          .then(() => {
            day += 1
            step()
          })
      }, 700)
    }
    setTimeout(step, 8000) // 等首帧渲染稳定
  }

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
