/**
 * M7-3 用户设置：主进程独有 settings.json（与存档同目录，原子写）。
 * 职责：载入/合并默认值、部分更新落盘、应用到窗口（尺寸/透明度/自启）。
 * renderer 通过 IPC 读写；窗口属性（初始尺寸）在 createWindow 前就需要，故归主进程所有。
 */
import { app, BrowserWindow } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { DEFAULT_SETTINGS, type AppSettings } from '../shared/protocol'

let settingsPath = ''
let cache: AppSettings = { ...DEFAULT_SETTINGS }

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/** 载入 + 防御性归一（旧版本/手改/损坏都回落默认值的合法区间） */
export function initSettings(saveDir: string): AppSettings {
  settingsPath = path.join(saveDir, 'settings.json')
  mkdirSync(saveDir, { recursive: true })
  try {
    if (existsSync(settingsPath)) {
      const raw = JSON.parse(readFileSync(settingsPath, 'utf8')) as Partial<AppSettings>
      cache = {
        windowScale: clamp(Number(raw.windowScale ?? DEFAULT_SETTINGS.windowScale), 0.6, 1.4),
        opacity: clamp(Number(raw.opacity ?? DEFAULT_SETTINGS.opacity), 0.4, 1),
        launchAtLogin: raw.launchAtLogin === true,
        passthroughWhenIdle: raw.passthroughWhenIdle !== false,
      }
    }
  } catch {
    cache = { ...DEFAULT_SETTINGS }
  }
  applyLoginItem(cache)
  return cache
}

export function getSettings(): AppSettings {
  return cache
}

/** 部分更新：钳值 → 应用 → 原子落盘。返回生效后的完整设置。 */
export function updateSettings(win: BrowserWindow | undefined, patch: Partial<AppSettings>): AppSettings {
  if (patch.windowScale !== undefined) cache.windowScale = clamp(patch.windowScale, 0.6, 1.4)
  if (patch.opacity !== undefined) cache.opacity = clamp(patch.opacity, 0.4, 1)
  if (patch.launchAtLogin !== undefined) cache.launchAtLogin = patch.launchAtLogin
  if (patch.passthroughWhenIdle !== undefined) cache.passthroughWhenIdle = patch.passthroughWhenIdle
  applyToWindow(win, cache)
  applyLoginItem(cache)
  try {
    const tmp = settingsPath + '.tmp'
    writeFileSync(tmp, JSON.stringify(cache, null, 2))
    renameSync(tmp, settingsPath)
  } catch (err) {
    console.error('[settings] 落盘失败（不影响本次会话）', err)
  }
  return cache
}

/** 应用到窗口：尺寸按 windowScale 缩放（基准 380×460），整窗不透明度 */
export function applyToWindow(win: BrowserWindow | undefined, s: AppSettings): void {
  if (!win || win.isDestroyed()) return
  win.setBounds({
    width: Math.round(380 * s.windowScale),
    height: Math.round(460 * s.windowScale),
  })
  win.setOpacity(s.opacity)
}

function applyLoginItem(s: AppSettings): void {
  // dev 环境注册自启会指向 electron.exe，无意义且危险——仅打包版生效
  if (!app.isPackaged) return
  app.setLoginItemSettings({ openAtLogin: s.launchAtLogin })
}
