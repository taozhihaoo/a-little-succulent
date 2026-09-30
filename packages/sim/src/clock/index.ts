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
