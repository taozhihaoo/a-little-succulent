/**
 * S2 模拟内核验证（05 §3）——长期作为回归测试第一条。
 * 全部比较基于 JSON 字符串（状态与事件流逐字节一致）。
 */
import { describe, expect, it } from 'vitest'
import { SIM_STEP_MS } from '../clock'
import { createEngine, createInMemoryWal, createWorld } from '../engine'
import { parseSave, serializeSave } from '../persist'
import type { EnvConfig } from '../world'

const HOUR = 3_600_000
const DAY = 24 * HOUR

const ENV: EnvConfig = {
  placement: 'windowsill',
  utcOffsetMinutes: 480,
  hemisphere: 'north',
}

function freshEngine() {
  const wal = createInMemoryWal()
  const world = createWorld('plant-018-seed', 0, ENV)
  const engine = createEngine({ world, wal })
  return { engine, wal }
}

function runWithChunks(chunks: readonly number[], waterAt: readonly number[] = [3 * DAY + 10.6 * HOUR, 7 * DAY + 2.3 * HOUR]) {
  const { engine } = freshEngine()
  for (const t of waterAt) engine.apply({ seq: 0, simTime: t, type: 'water' })
  let cursor = 0
  for (const c of chunks) {
    cursor += c
    engine.advance(cursor, Number.MAX_SAFE_INTEGER)
  }
  return {
    world: JSON.stringify(engine.world),
    events: JSON.stringify(engine.events),
  }
}

describe('S2 网格不变量（05 §3）', () => {
  it('任意推进序列后 simTime 恒落在网格上；target 不齐也会被 floor', () => {
    const { engine } = freshEngine()
    for (const target of [0.5 * HOUR, 3 * DAY + 10.6 * HOUR, 30 * DAY]) {
      engine.advance(target, Number.MAX_SAFE_INTEGER)
      expect(engine.simTime % SIM_STEP_MS).toBe(0)
    }

    const { engine: e2 } = freshEngine()
    e2.advance(5 * DAY + 0.77 * HOUR, Number.MAX_SAFE_INTEGER)
    expect(e2.simTime).toBe(5 * DAY)
  })
})

describe('S2 三重一致（05 §3）', () => {
  it('连续推进 == 5d+5d 分片 == 逐小时分片（状态与事件流逐字节一致）', () => {
    const continuous = runWithChunks([20 * DAY])
    const chunked5 = runWithChunks([5 * DAY, 5 * DAY, 5 * DAY, 5 * DAY])
    const hourly = runWithChunks(Array.from({ length: 480 }, () => HOUR))
    expect(chunked5).toEqual(continuous)
    expect(hourly).toEqual(continuous)
  })

  it('advance 受 maxSteps 限制时分片推进，结果不变', () => {
    const straight = runWithChunks([20 * DAY])
    const { engine } = freshEngine()
    for (const t of [3 * DAY + 10.6 * HOUR, 7 * DAY + 2.3 * HOUR]) {
      engine.apply({ seq: 0, simTime: t, type: 'water' })
    }
    let done = false
    while (!done) {
      done = engine.advance(20 * DAY, 10).done
    }
    expect(JSON.stringify(engine.world)).toBe(straight.world)
    expect(JSON.stringify(engine.events)).toBe(straight.events)
  })
})

describe('S2 存档续跑（05 §3）', () => {
  it('Day10 检查点 → 序列化/反序列化 → 载入推至 Day20 == 直推', () => {
    // 参照：直推
    const straight = runWithChunks([20 * DAY])

    // 分支：推到 Day10，存档，"进程消失"
    const { engine } = freshEngine()
    for (const t of [3 * DAY + 10.6 * HOUR, 7 * DAY + 2.3 * HOUR]) {
      engine.apply({ seq: 0, simTime: t, type: 'water' })
    }
    engine.advance(10 * DAY, Number.MAX_SAFE_INTEGER)
    const saveJson = serializeSave(engine.checkpoint())
    const eventsPrefix = JSON.parse(JSON.stringify(engine.events)) as typeof engine.events

    // 载入：从存档重建引擎（事件前缀 + 序号水位）
    const save = parseSave(saveJson)
    const restored = createEngine({
      world: save.world,
      events: eventsPrefix,
      eventSeq: eventsPrefix.length > 0 ? eventsPrefix[eventsPrefix.length - 1]!.seq : 0,
      inputSeq: save.inputWalOffset,
    })
    restored.advance(20 * DAY, Number.MAX_SAFE_INTEGER)

    expect(JSON.stringify(restored.world)).toBe(straight.world)
    expect(JSON.stringify(restored.events)).toBe(straight.events)
  })
})

describe('S2 崩溃恢复（05 §3 / 02 §6.4）', () => {
  it('WAL 回放后：事件日志无重复、无丢失，状态一致', () => {
    // 参照与崩溃剧本使用同一浇水剧本（第二笔在检查点之后）
    const scenarioWaterAt = [3 * DAY + 10.6 * HOUR, 12 * DAY + 4.2 * HOUR]
    const straight = runWithChunks([20 * DAY], scenarioWaterAt)

    // 正常时间线：推到 Day10 → 检查点落盘 → 崩溃前又浇了一次水（只存在于 WAL）→ 推到 Day20
    const { engine, wal } = freshEngine()
    engine.apply({ seq: 0, simTime: 3 * DAY + 10.6 * HOUR, type: 'water' })
    engine.advance(10 * DAY, Number.MAX_SAFE_INTEGER)
    const checkpoint = parseSave(serializeSave(engine.checkpoint()))
    const eventsPrefix = JSON.parse(JSON.stringify(engine.events)) as typeof engine.events

    engine.apply({ seq: 0, simTime: 12 * DAY + 4.2 * HOUR, type: 'water' })
    engine.advance(20 * DAY, Number.MAX_SAFE_INTEGER)

    // "重启"：从 Day10 检查点恢复 + 重放 WAL 水位之后的输入
    const restored = createEngine({
      world: checkpoint.world,
      events: eventsPrefix,
      eventSeq: eventsPrefix.length > 0 ? eventsPrefix[eventsPrefix.length - 1]!.seq : 0,
      inputSeq: checkpoint.inputWalOffset,
    })
    for (const entry of wal.entries()) {
      if (entry.seq > checkpoint.inputWalOffset) {
        restored.apply({ ...entry, seq: 0 })
      }
    }
    restored.advance(20 * DAY, Number.MAX_SAFE_INTEGER)

    // 与直推参照逐字节一致 ⇒ 无重复、无丢失
    expect(JSON.stringify(restored.world)).toBe(straight.world)
    expect(JSON.stringify(restored.events)).toBe(straight.events)
  })
})

describe('S2 时间异常（05 §3 / 02 §1.4）', () => {
  it('时钟回拨：target 在过去 ⇒ 不推进、无事件', () => {
    const { engine } = freshEngine()
    engine.advance(5 * DAY, Number.MAX_SAFE_INTEGER)
    const before = engine.simTime
    const eventsBefore = engine.events.length
    engine.advance(2 * DAY, Number.MAX_SAFE_INTEGER)
    expect(engine.simTime).toBe(before)
    expect(engine.events.length).toBe(eventsBefore)
  })

  it('休眠 8h 唤醒：一次性补算 == 从未中断的连续运行', () => {
    const continuous = runWithChunks([7 * DAY + 8 * HOUR], [3 * DAY + 10.6 * HOUR])

    const { engine } = freshEngine()
    engine.apply({ seq: 0, simTime: 3 * DAY + 10.6 * HOUR, type: 'water' })
    engine.advance(7 * DAY, Number.MAX_SAFE_INTEGER) // "睡前"
    engine.advance(7 * DAY + 8 * HOUR, Number.MAX_SAFE_INTEGER) // "唤醒"一次补算

    expect(JSON.stringify(engine.world)).toBe(continuous.world)
    expect(JSON.stringify(engine.events)).toBe(continuous.events)
  })
})
