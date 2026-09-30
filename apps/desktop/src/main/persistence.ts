/**
 * PersistenceService（07 §2）：文件 IO 只在主进程。
 * 布局（userData/succulent-save/）：
 *   save.json    检查点（原子写：tmp + rename）
 *   inputs.jsonl 输入 WAL（追加，永不截断——重放数据源，02 §6.4）
 *   events.jsonl 事件日志（追加；载入时按检查点 eventCount 截断，02 §6.4）
 */
import { app, ipcMain } from 'electron'
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { IpcChannels } from '../shared/protocol'

let saveDir = ''

export function initPersistence(): void {
  saveDir = path.join(app.getPath('userData'), 'succulent-save')
  mkdirSync(saveDir, { recursive: true })

  ipcMain.handle(IpcChannels.PersistenceLoad, () => {
    const savePath = path.join(saveDir, 'save.json')
    const saveJson = existsSync(savePath) ? readFileSync(savePath, 'utf8') : null

    // 事件日志：按检查点的 eventCount 截断——之后的部分由确定性重放重新生成
    const evPath = path.join(saveDir, 'events.jsonl')
    let eventLines: string[] = []
    if (existsSync(evPath)) {
      eventLines = readFileSync(evPath, 'utf8').split('\n').filter((l) => l.length > 0)
      if (saveJson) {
        try {
          const count = (JSON.parse(saveJson) as { eventCount?: number }).eventCount
          if (typeof count === 'number' && count < eventLines.length) {
            eventLines = eventLines.slice(0, count)
            writeFileSync(evPath, eventLines.length > 0 ? eventLines.join('\n') + '\n' : '')
          }
        } catch {
          // 检查点损坏时保留全部事件（renderer 侧会按需处理）
        }
      }
    }

    const inPath = path.join(saveDir, 'inputs.jsonl')
    const inputLines = existsSync(inPath)
      ? readFileSync(inPath, 'utf8').split('\n').filter((l) => l.length > 0)
      : []

    return { saveJson, inputLines, eventLines }
  })

  ipcMain.handle(
    IpcChannels.PersistenceCheckpoint,
    (_event, saveJson: unknown, newEventLines: unknown) => {
      if (typeof saveJson !== 'string' || saveJson.length === 0) return
      const tmp = path.join(saveDir, 'save.json.tmp')
      writeFileSync(tmp, saveJson)
      renameSync(tmp, path.join(saveDir, 'save.json'))
      if (typeof newEventLines === 'string' && newEventLines.length > 0) {
        // 轮转：超 512KB 归档为 events.1.jsonl（保留一代，02 §6.2）
        const evPath = path.join(saveDir, 'events.jsonl')
        if (existsSync(evPath) && statSync(evPath).size > 512 * 1024) {
          renameSync(evPath, path.join(saveDir, 'events.1.jsonl'))
        }
        appendFileSync(
          evPath,
          newEventLines.endsWith('\n') ? newEventLines : newEventLines + '\n',
        )
      }
    },
  )

  ipcMain.on(IpcChannels.PersistenceAppendInput, (_event, line: unknown) => {
    if (typeof line === 'string' && line.length > 0) {
      appendFileSync(path.join(saveDir, 'inputs.jsonl'), line + '\n')
    }
  })

  // dev 危险操作：清除全部存档（Console 重置按钮）
  ipcMain.handle(IpcChannels.PersistenceReset, () => {
    for (const f of ['save.json', 'inputs.jsonl', 'events.jsonl']) {
      const fp = path.join(saveDir, f)
      if (existsSync(fp)) rmSync(fp)
    }
  })
}
