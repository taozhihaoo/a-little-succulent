/** 时间模型（02 §1）。sim 内禁止读取当前时间——时间一律外部注入（ARCHITECTURE 不变量 3）。 */

/** 1 逻辑步 = 1 模拟小时 */
export const SIM_STEP_MS = 3_600_000

export interface ClockState {
  /** 单调虚拟时间（epoch 毫秒），永远落在步网格上（02 §1.3） */
  simTime: number
  /** 最近一次 WallTime 锚点，用于回拨检测（02 §1.4） */
  lastWallSeen: number
}

/** 向下对齐到步网格 */
export function floorToGrid(simTime: number): number {
  return Math.floor(simTime / SIM_STEP_MS) * SIM_STEP_MS
}

/** simTime 之后的下一个步边界（输入结算点，02 §1.3） */
export function nextBoundary(simTime: number): number {
  return floorToGrid(simTime) + SIM_STEP_MS
}

/** WallTime → 推进目标：floorToGrid(wallNow)，永不超前于网格 */
export function gridTarget(wallNow: number): number {
  return floorToGrid(wallNow)
}

export type WallDeltaVerdict =
  | { status: 'ok'; wallDelta: number }
  | { status: 'rolled-back'; observed: number; lastSeen: number }

/** 回拨检测（02 §1.4）：墙钟倒退时不推进，交由上层进入保护逻辑 */
export function judgeWallDelta(lastWallSeen: number, wallNow: number): WallDeltaVerdict {
  return wallNow < lastWallSeen
    ? { status: 'rolled-back', observed: wallNow, lastSeen: lastWallSeen }
    : { status: 'ok', wallDelta: wallNow - lastWallSeen }
}

/**
 * 超前再锚定（M5 长期成立）：快进调试等手段会让 simTime 跑到墙钟之后（judgeWallDelta 只防
 * 回拨，防不了超前）；超前状态下每次追赶都是空转，挂件会永远活在"未来"的光照与季节里。
 * 处理：整体平移世界所有时间戳回到墙钟——所有时长语义（叶龄、间隔、冷却）不变，只改纪元。
 * 超前 ≤48h 视为正常快进余量，不平移。返回实际平移量（0 = 未触发）。
 */
export function reanchorSimTime(world: { simTime: number; plants: unknown[] }, wallNow: number, maxAheadMs = 48 * 3_600_000): number {
  const drift = world.simTime - wallNow
  if (drift <= maxAheadMs) return 0
  for (const p of world.plants as Array<import('../world').PlantState>) {
    p.bornSimTime -= drift
    for (const l of p.leaves) {
      l.bornSimTime -= drift
      if (l.droppedSimTime !== undefined) l.droppedSimTime -= drift
    }
    // 计数器混有两种语义：标记（0/1 等）与时间戳（epoch ms）。只平移时间戳量级的值。
    for (const k of Object.keys(p.counters)) {
      if (p.counters[k]! > 1e12) p.counters[k] = p.counters[k]! - drift
    }
    if (p.signs) {
      for (const s of p.signs) {
        s.startedSimTime -= drift
        if (s.occurredSimTime !== undefined) s.occurredSimTime -= drift
      }
    }
  }
  world.simTime -= drift
  return drift
}
