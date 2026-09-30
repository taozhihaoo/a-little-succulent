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

/**
 * TODO(M3)：按 04 规格实现光照日曲线与季节曲线。
 * 日历换算必须用纯算术（epoch ms → 当地时刻），禁止 Date 类型（ARCHITECTURE 不变量 3）。
 */
export function sampleEnv(simTime: number, env: EnvConfig): EnvSample {
  void simTime
  void env
  throw new Error('sampleEnv: M3 落地（02 §2.2 + 04 光照/季节曲线）')
}
