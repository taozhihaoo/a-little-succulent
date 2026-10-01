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
import { IpcChannels } from '../shared/protocol'
import { createCloudAdapter, type CloudAdapter } from './cloud'

let cloud: CloudAdapter | undefined

export function initPersistence(): void {
  // soak 模式独立存档目录，不污染日常验收植物
  const base = process.env.SUCCULENT_SOAK ? path.join(app.getPath('userData'), 'soak-save') : app.getPath('userData')
  cloud = createCloudAdapter(path.join(base, 'succulent-save'))

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
}
