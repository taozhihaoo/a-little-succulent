/**
 * PersistenceService（07 §2）：文件 IO 只在主进程。
 * M6-5 起存储后端抽象为 CloudAdapter（cloud.ts）——本文件只保留 IPC 薄壳。
 * 布局（LocalCloudAdapter，userData/succulent-save/）：
 *   save.json    检查点（原子写：tmp + rename）
 *   inputs.jsonl 输入 WAL（追加，永不截断——重放数据源，02 §6.4）
 *   events.jsonl 事件日志（追加；载入时按检查点 eventCount 截断，02 §6.4）
 */
import { app, ipcMain } from 'electron'
import path from 'node:path'
import { cpSync, existsSync } from 'node:fs'
import { IpcChannels } from '../shared/protocol'
import { createCloudAdapter, type CloudAdapter } from './cloud'

let cloud: CloudAdapter | undefined

export function initPersistence(): string {
  // soak 模式独立存档目录，不污染日常验收植物
  const base = process.env.SUCCULENT_SOAK ? path.join(app.getPath('userData'), 'soak-save') : app.getPath('userData')
  const saveDir = path.join(base, 'succulent-save')

  // 打包版 productName 与 dev 包名不同 → userData 路径不同。首次启动一次性迁移旧存档，
  // 保住用户的植株（原件保留防回滚）。dev 下两者同路径，此分支自然不触发。
  const legacySave = path.join(app.getPath('appData'), '@succulent', 'desktop', 'succulent-save')
  if (saveDir !== legacySave && !existsSync(path.join(saveDir, 'save.json')) && existsSync(path.join(legacySave, 'save.json'))) {
    cpSync(legacySave, saveDir, { recursive: true })
    console.info('[persist] 已从 dev 旧目录迁移存档:', legacySave)
  }

  cloud = createCloudAdapter(saveDir)

  ipcMain.handle(IpcChannels.PersistenceLoad, () => cloud!.load())

  ipcMain.handle(IpcChannels.PersistenceCheckpoint, (_event, saveJson: unknown, newEventLines: unknown) => {
    if (typeof saveJson !== 'string' || saveJson.length === 0) return
    cloud!.checkpoint(saveJson, typeof newEventLines === 'string' ? newEventLines : '')
  })

  ipcMain.on(IpcChannels.PersistenceAppendInput, (_event, line: unknown) => {
    if (typeof line === 'string' && line.length > 0) cloud!.appendInput(line)
  })

  // dev 危险操作：清除全部存档（Console 重置按钮）
  ipcMain.handle(IpcChannels.PersistenceReset, () => cloud!.reset())
  return saveDir
}
