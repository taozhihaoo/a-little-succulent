/**
 * M6-5 Cloud Save 抽象：三件套（检查点/输入 WAL/事件日志）的存储后端接口。
 * LocalCloudAdapter = 现行本地文件实现（userData/succulent-save/）；
 * SteamCloudAdapter = M7 接入 Steamworks Remote Storage 的换点（当前仅骨架）。
 * 工厂 createCloudAdapter()：检测到 Steam 环境但 Steamworks 未接线时回退本地并提示。
 * 约束不变：输入 WAL 追加永不截断（重放数据源，02 §6.4）。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export interface CloudBlobs {
  saveJson: string | null
  inputLines: string[]
  eventLines: string[]
}

export interface CloudAdapter {
  readonly name: string
  load(): CloudBlobs
  /** 原子替换检查点 + 追加新事件（newEventLines 为 jsonl 片段，可空） */
  checkpoint(saveJson: string, newEventLines: string): void
  appendInput(line: string): void
  reset(): void
}

/** 本地文件实现：原子检查点（tmp+rename）+ 事件多代归档链（M3-13）+ 归档摘要 */
export class LocalCloudAdapter implements CloudAdapter {
  readonly name = 'local'

  constructor(
    private readonly dir: string,
    /** 轮转阈值（默认 512KB，02 §6.2）；测试可调小 */
    private readonly rotateBytes = 512 * 1024,
    /** 归档保留代数：events.1(最新) ~ events.{gens-1}(最老) */
    private readonly archiveGens = 3,
  ) {
    mkdirSync(dir, { recursive: true })
  }

  load(): CloudBlobs {
    const savePath = path.join(this.dir, 'save.json')
    const saveJson = existsSync(savePath) ? readFileSync(savePath, 'utf8') : null

    // 事件日志：按检查点的 eventCount 截断——之后的部分由确定性重放重新生成
    const evPath = path.join(this.dir, 'events.jsonl')
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

    const inPath = path.join(this.dir, 'inputs.jsonl')
    const inputLines = existsSync(inPath)
      ? readFileSync(inPath, 'utf8').split('\n').filter((l) => l.length > 0)
      : []

    return { saveJson, inputLines, eventLines }
  }

  checkpoint(saveJson: string, newEventLines: string): void {
    const tmp = path.join(this.dir, 'save.json.tmp')
    writeFileSync(tmp, saveJson)
    renameSync(tmp, path.join(this.dir, 'save.json'))
    if (newEventLines.length > 0) {
      const evPath = path.join(this.dir, 'events.jsonl')
      // 轮转：超阈值时整链上移一代（M3-13），并重写归档摘要
      if (existsSync(evPath) && statSync(evPath).size > this.rotateBytes) {
        this.rotateEventLog()
      }
      appendFileSync(evPath, newEventLines.endsWith('\n') ? newEventLines : newEventLines + '\n')
    }
  }

  appendInput(line: string): void {
    appendFileSync(path.join(this.dir, 'inputs.jsonl'), line + '\n')
  }

  reset(): void {
    for (const f of ['save.json', 'inputs.jsonl', 'events.jsonl']) {
      const fp = path.join(this.dir, f)
      if (existsSync(fp)) rmSync(fp)
    }
  }

  /** 归档链：events.2→events.3（最老丢弃）… events.jsonl→events.1，随后重写摘要（M3-13） */
  private rotateEventLog(): void {
    for (let g = this.archiveGens - 1; g >= 1; g--) {
      const from = path.join(this.dir, g === 1 ? 'events.jsonl' : `events.${g - 1}.jsonl`)
      const to = path.join(this.dir, `events.${g}.jsonl`)
      if (!existsSync(from)) continue
      rmSync(to, { force: true }) // Windows renameSync 不覆盖已存在目标
      renameSync(from, to)
    }
    this.writeArchiveSummary()
  }

  /** 汇总全部归档代：每 kind 条数 + 时间范围（events-summary.json，排障与验收用） */
  private writeArchiveSummary(): void {
    try {
      const counts: Record<string, number> = {}
      let total = 0
      let first: number | null = null
      let last: number | null = null
      for (let g = 1; g < this.archiveGens; g++) {
        const f = path.join(this.dir, `events.${g}.jsonl`)
        if (!existsSync(f)) continue
        for (const line of readFileSync(f, 'utf8').split('\n')) {
          if (!line) continue
          try {
            const e = JSON.parse(line) as { kind?: string; simTime?: number }
            if (typeof e.kind !== 'string') continue
            counts[e.kind] = (counts[e.kind] ?? 0) + 1
            total++
            if (typeof e.simTime === 'number') {
              if (first === null || e.simTime < first) first = e.simTime
              if (last === null || e.simTime > last) last = e.simTime
            }
          } catch {
            // 单行损坏跳过（摘要容错）
          }
        }
      }
      writeFileSync(
        path.join(this.dir, 'events-summary.json'),
        JSON.stringify({ rotatedAt: Date.now(), total, first, last, counts }, null, 2),
      )
    } catch {
      // 摘要失败不影响主流程
    }
  }
}

/**
 * Steamworks Cloud 换点（M7）：load/checkpoint 换成 RemoteStorage 三件套读写。
 * 当前仅骨架（方法不可调用）；工厂在检测到 Steam 环境时也仍回退本地。
 */
export class SteamCloudAdapter implements CloudAdapter {
  readonly name = 'steam'

  static isSteamEnvironment(): boolean {
    return process.env['SteamAppId'] !== undefined || process.env['STEAMAPPID'] !== undefined
  }

  load(): CloudBlobs {
    throw new Error('SteamCloudAdapter: Steamworks Cloud 随 M7 接入')
  }

  checkpoint(): void {
    throw new Error('SteamCloudAdapter: Steamworks Cloud 随 M7 接入')
  }

  appendInput(): void {
    throw new Error('SteamCloudAdapter: Steamworks Cloud 随 M7 接入')
  }

  reset(): void {
    throw new Error('SteamCloudAdapter: Steamworks Cloud 随 M7 接入')
  }
}

/** 后端选择：Steamworks 接线（M7）后此处改为返回 SteamCloudAdapter */
export function createCloudAdapter(dir: string): CloudAdapter {
  if (SteamCloudAdapter.isSteamEnvironment()) {
    console.info('[cloud] Steam 环境检测到——Steamworks Cloud 随 M7 接入，当前使用本地存档')
  }
  return new LocalCloudAdapter(dir)
}
