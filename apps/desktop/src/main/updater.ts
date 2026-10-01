/**
 * M7-2 自动更新（electron-updater，GitHub Releases provider）。
 * 策略：静默下载，退出时自动安装（挂件不打断用户）；下载完成 toast 提醒一次。
 * dev 不检查；发布源不存在（当前无 Release）时静默失败——不弹错误。
 */
import { app, BrowserWindow, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import { IpcChannels } from '../shared/protocol'

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

export function initAutoUpdater(getWin: () => BrowserWindow | undefined): void {
  if (!app.isPackaged) return

  let announced = false
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-downloaded', () => {
    if (announced) return
    announced = true
    getWin()?.webContents.send(IpcChannels.AppUpdateReady)
  })
  autoUpdater.on('error', (err) => {
    // 无发布源 / 网络不可达：静默（挂件不弹错误）
    console.info('[update] check failed (silent):', String(err).slice(0, 120))
  })

  const check = (): void => {
    void autoUpdater.checkForUpdates().catch(() => { /* 静默 */ })
  }
  setTimeout(check, 30_000)
  setInterval(check, CHECK_INTERVAL_MS)
}

export function registerUpdateIpc(): void {
  // 预留：设置面板"检查更新"按钮（renderer → 主进程手动触发）
  ipcMain.handle(IpcChannels.AppUpdateCheck, () => {
    if (!app.isPackaged) return { packaged: false }
    void autoUpdater.checkForUpdates().catch(() => { /* 静默 */ })
    return { packaged: true, checking: true }
  })
}
