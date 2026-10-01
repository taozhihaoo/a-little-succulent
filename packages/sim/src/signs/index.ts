/**
 * 迹象系统（M4 任务 7 / 总方案 §6 / §27）：
 * 每个迹象 = 一个生命周期状态机（潜伏→迹象→酝酿→临界→发生→余韵），
 * SignalStrength 0~1 随条件积分爬升，相位由强度阈值推进。
 * 事件仅在相位跃迁时发出（带 signalStrength），受事件预算约束。
 * 确定性：progress/strength 全部由状态与环境纯函数计算（I1）。
 */
import type { EnvSample } from '../env'
import type { EventSink, EventTier } from '../events'
import type { PlantState } from '../world'

export type SignPhase =
  | 'latent' // 潜伏（<0.15）
  | 'signal' // 迹象（0.15~0.45）
  | 'developing' // 酝酿（0.45~0.75）
  | 'critical' // 临界（0.75~1）
  | 'occurred' // 发生（progress 达 1）
  | 'afterglow' // 余韵（发生后保留一段时间）

export interface SignState {
  id: string
  phase: SignPhase
  /** SignalStrength 0~1（R5：随生命周期爬升，驱动渲染强度） */
  strength: number
  startedSimTime: number
  /** 发生时刻（occurred 进入时记录；afterglow 结束后迹象归档） */
  occurredSimTime?: number
}

export interface SignDef {
  id: string
  /** 0~1 目标进度：由条件积分纯函数计算（确定性，I1） */
  progress(plant: PlantState, env: EnvSample, simTime: number): number
  /** 发生事件层级（缺水类 growth；开花/子株 major） */
  tier: EventTier
  /** 发生后余韵时长（模拟 ms），随后迹象归档消失 */
  afterglowMs: number
}

/** 强度→相位阈值（总方案 §27：0.1 极弱 / 0.3 轮廓 / 0.6 明显 / 0.9 无法忽略） */
export function phaseOf(strength: number): SignPhase {
  if (strength < 0.15) return 'latent'
  if (strength < 0.45) return 'signal'
  if (strength < 0.75) return 'developing'
  return 'critical'
}

const DAY_MS = 86_400_000

/** 相位跃迁事件（预算走 tryEmit 同款冷却 + tier 日配额，由调用方传入 allow） */
function emitPhase(
  plant: PlantState,
  sign: SignState,
  tier: EventTier,
  simTime: number,
  allow: (plant: PlantState, tier: EventTier, simTime: number) => boolean,
  emit: EventSink,
): void {
  if (!allow(plant, tier, simTime)) return
  emit({
    simTime,
    plantId: plant.id,
    kind: `sign.${sign.id}.${sign.phase}`,
    tier,
    signalStrength: sign.strength,
  })
}

/**
 * 推进单株全部迹象。每逻辑步调用一次（dtMs = 步长）。
 * allow：事件预算闸门（step/index 的 budgetAllow）。
 */
export function stepSigns(
  plant: PlantState,
  defs: readonly SignDef[],
  env: EnvSample,
  dtMs: number,
  simTime: number,
  allow: (plant: PlantState, tier: EventTier, simTime: number) => boolean,
  emit: EventSink,
  onOccurred?: (plant: PlantState, sign: SignState, simTime: number) => void,
): void {
  plant.signs ??= []
  for (const def of defs) {
    let sign: SignState | undefined = plant.signs.find((sg) => sg.id === def.id)
    const progress = Math.max(0, Math.min(1, def.progress(plant, env, simTime)))

    // 未激活：progress 越过潜伏阈值则萌芽
    if (!sign) {
      if (progress < 0.08) continue
      sign = { id: def.id, phase: 'latent', strength: 0, startedSimTime: simTime }
      plant.signs.push(sign)
    }

    // 余韵：倒计时后归档
    if (sign.phase === 'afterglow') {
      if (simTime - (sign.occurredSimTime ?? simTime) >= def.afterglowMs) {
        plant.signs = plant.signs.filter((sg) => sg !== sign)
      }
      continue
    }

    // 已发生：发余韵事件一次，随后倒计时
    if (sign.phase === 'occurred') {
      onOccurred?.(plant, sign, simTime)
      emitPhase(plant, sign, 'major', simTime, allow, emit)
      sign.occurredSimTime = simTime
      sign.phase = 'afterglow'
      continue
    }

    // 强度向进度缓动（每天最多接近 ~0.12，慢节奏酝酿）
    const rate = (0.12 / DAY_MS) * dtMs
    sign.strength += Math.max(-rate, Math.min(rate, progress - sign.strength))
    sign.strength = Math.max(0, Math.min(1, sign.strength))

    // 相位推进：progress 达 1 → 发生；否则按强度阈值
    const prev = sign.phase
    let next: SignPhase = sign.phase
    if (progress >= 1) {
      next = 'occurred'
    } else {
      next = phaseOf(sign.strength)
    }
    if (next !== prev) {
      sign.phase = next
      sign.strength = Math.max(sign.strength, 0.05) // 跃迁即立即可感（R5）
      emitPhase(
        plant,
        sign,
        next === 'occurred' ? def.tier : 'growth',
        simTime,
        allow,
        emit,
      )
    }
  }
}
