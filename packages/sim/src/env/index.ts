/** 环境曲线与日历（02 §2.2，07 §3）。纯函数；时间由外部注入。 */
import type { EnvConfig } from '../world'

export interface EnvSample {
  /** 0~1 当前光照 */
  light: number
  /** 摄氏度 */
  temperature: number
  /** 0~1 相对湿度 */
  humidity: number
  /** 0~1 昼夜相位（0 = 午夜，0.5 = 正午；由 utcOffset 换算） */
  dayPhase: number
  /** 0~1 季节相位（由 hemisphere 修正） */
  seasonPhase: number
}

const DAY_MS = 86_400_000
const YEAR_MS = 365.25 * DAY_MS

const PLACEMENT_LIGHT: Record<EnvConfig['placement'], number> = {
  windowsill: 0.95,
  'table-center': 0.6,
  lamp: 0.5,
  shade: 0.3,
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/**
 * S2 占位实现：确定性纯算术曲线（白昼钟形 × 摆放位系数 + 年相位）。
 * TODO(M3)：按真实光照日曲线 / 季节系数替换（02 §2.2 + 04）。
 * 日历换算全部为纯算术，禁止 Date 类型（ARCHITECTURE 不变量 3）。
 */
export function sampleEnv(simTime: number, env: EnvConfig): EnvSample {
  const localMs = simTime + env.utcOffsetMinutes * 60_000
  const dayPhase = ((localMs % DAY_MS) + DAY_MS) % DAY_MS / DAY_MS

  // 白昼 06:00–18:00 的钟形光照
  const daylight =
    dayPhase >= 0.25 && dayPhase <= 0.75 ? Math.sin((Math.PI * (dayPhase - 0.25)) / 0.5) : 0
  const light = clamp01(daylight * PLACEMENT_LIGHT[env.placement])

  const yearPhase = (((simTime % YEAR_MS) + YEAR_MS) % YEAR_MS) / YEAR_MS
  const seasonPhase = env.hemisphere === 'north' ? yearPhase : (yearPhase + 0.5) % 1

  return {
    light,
    temperature: 20 + 6 * light,
    humidity: 0.45,
    dayPhase,
    seasonPhase,
  }
}
