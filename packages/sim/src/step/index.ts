/**
 * 单步结算（02 §2.1）。固定顺序，不可重排；确定性由 S2 回归测试钉住（05 §3）。
 * S2 阶段内联占位生长规则；TODO(M1)：生长移入 species/echeveria 的 growStep（04 §5）。
 */
import type { EventSink, EventTier } from '../events'
import type { Rng } from '../rng'
import type { InputEvent, PlantState, WorldState } from '../world'
import { getSpecies } from '../species/registry'
import { ECHEVERIA_SIGNS } from '../species/echeveria'
import { stepSigns } from '../signs'
import { sampleEnv } from '../env'

export interface StepCtx {
  rng: Rng
  emit: EventSink
  /** 本步起始的 simTime（网格上） */
  simTime: number
  /** 本步结算的已确认输入（下一个步边界生效，02 §1.3），按 (simTime, seq) 排序 */
  inputs: readonly InputEvent[]
}

export interface StepResult {
  eventsEmitted: number
}

// 占位系数（数值 M1/M3 按 04 调参替换）
const EVAP_PER_HOUR = 0.1 / 24
const WATER_AMOUNT = 0.35
const DAY_MS = 86_400_000

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/** 事件预算（02 §2.4）：tier 每日上限，计数器随存档持久化 → 重放天然一致 */
const TIER_DAILY_CAP: Record<EventTier, number> = { micro: 12, growth: 6, major: 1 }

function budgetAllow(plant: PlantState, tier: EventTier, simTime: number): boolean {
  const day = Math.floor(simTime / DAY_MS)
  const key = `budget:${tier}:${day}`
  const used = plant.counters[key] ?? 0
  if (used >= TIER_DAILY_CAP[tier]) return false
  plant.counters[key] = used + 1
  return true
}

/** 事件冷却（02 §2.4）：计数器存在 plant.counters，随存档持久化 → 重放天然一致 */
function tryEmit(
  plant: PlantState,
  kind: string,
  tier: EventTier,
  cooldownMs: number,
  simTime: number,
  emit: EventSink,
): boolean {
  const key = `cool:${kind}`
  const last = plant.counters[key]
  if (last !== undefined && simTime - last < cooldownMs) return false
  if (!budgetAllow(plant, tier, simTime)) return false
  plant.counters[key] = simTime
  emit({ simTime, plantId: plant.id, kind, tier })
  return true
}

export function simulateStep(world: WorldState, dtMs: number, ctx: StepCtx): StepResult {
  const dtHours = dtMs / 3_600_000
  const stepEnd = world.simTime + dtMs
  let emitted = 0
  const env = sampleEnv(world.simTime, world.env)

  for (const plant of world.plants) {
    // 1) 玩家输入结算（只认已确认输入；即时反馈由渲染层做，02 §1.3）
    for (const input of ctx.inputs) {
      if (input.type === 'water') plant.water = clamp01(plant.water + WATER_AMOUNT)
    }

    // 2) 水分动态（蒸发）
    plant.water = clamp01(plant.water - EVAP_PER_HOUR * dtHours)

    // 3) 应激累积器（带衰减；占位系数，M3 按 04 §7 替换）
    plant.stress.light = Math.max(
      0,
      plant.stress.light + env.light * 0.01 * dtHours - 0.008 * dtHours,
    )
    if (plant.water < 0.45) {
      plant.stress.drought += (0.45 - plant.water) * 0.02 * dtHours
    } else {
      plant.stress.drought = Math.max(0, plant.stress.drought - 0.01 * dtHours)
    }

    // 4) 生长：委托给物种的生长语法（02 §2.1 步 5；M1 起 echeveria 实现叶生命周期）
    getSpecies(plant.speciesId).growStep(plant, env, dtMs, ctx)

    // 5) 迹象生命周期（M4 任务 7）：条件积分 → 相位推进 → 预算化事件
    stepSigns(
      plant,
      ECHEVERIA_SIGNS,
      env,
      dtMs,
      stepEnd,
      budgetAllow,
      ctx.emit,
      // M4 任务 9：子株迹象"发生"→ 生成新 PlantState（基部幼株，同 species 同基因源）
      (parent, sign, simTime) => {
        if (sign.id === 'flowerSpike') {
          parent.spike = true
          return
        }
        if (sign.id !== 'offset') return
        if (world.plants.length >= 8) return // Slot 上限（总方案 §34：首发少 Slot）
        const childId = `${parent.id}-offset${world.plants.length}`
        world.plants.push({
          id: childId,
          speciesId: parent.speciesId,
          seed: `${parent.seed}|offset${world.plants.length}`,
          genome: parent.genome, // 子株遗传母株基因（M6 杂交前的简化遗传）
          bornSimTime: simTime,
          water: parent.water,
          stress: { light: 0, drought: 0, temp: 0 },
          stretch: 0,
          seasonPhase: parent.seasonPhase,
          leaves: [
            { bornSimTime: simTime, ringIndex: 0, maturity: 0.05, turgor: 1, colorState: 0, damage: 0, rand: 0.5 },
          ],
          stems: [{ heightMm: 2, lignification: 0 }],
          counters: {},
        })
      },
    )

    // 5) 事件检查：确定性阈值跨变（沿）+ 冷却；概率类事件与预算全量实现属 M3/M4
    const low = plant.water < 0.45
    const critical = plant.water < 0.1
    const wasLow = plant.counters['water.low.active'] === 1
    const wasCritical = plant.counters['water.critical.active'] === 1

    if (low && !wasLow) {
      plant.counters['water.low.active'] = 1
      if (tryEmit(plant, 'water.low', 'growth', 3 * DAY_MS, stepEnd, ctx.emit)) emitted++
    }
    if (critical && !wasCritical) {
      plant.counters['water.critical.active'] = 1
      if (tryEmit(plant, 'water.critical', 'growth', 3 * DAY_MS, stepEnd, ctx.emit)) emitted++
    }
    if (!low && wasLow) {
      plant.counters['water.low.active'] = 0
      if (tryEmit(plant, 'water.recovered', 'growth', 3 * DAY_MS, stepEnd, ctx.emit)) emitted++
    }
  }

  return { eventsEmitted: emitted }
}
