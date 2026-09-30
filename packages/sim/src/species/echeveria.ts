/**
 * 原型 A：莲座型 Echeveria（04 规格）。M1～M5 唯一原型（R10）。
 * 数值为 04 §3/§5 的调参起点；M2 按视觉验收滚动更新。
 */
import type { EnvSample } from '../env'
import type { Rng } from '../rng'
import type { StepCtx } from '../step'
import type { Genome, PlantState } from '../world'
import type { OrganPose, SpeciesDef } from './index'

const DAY = 86_400_000
const HOUR = 3_600_000
const EXPAND_DAYS = 13
const LIFE_DAYS = 13 + 45 + 22
const LIFE_MS = LIFE_DAYS * DAY
const MAX_ALIVE = 48
const DROP_KEEP_MS = 30 * DAY
const GOLDEN_ANGLE = 2.399963229728653

/** 04 §13 起始默认基因组（"好看集"，待 M2 调参锁定） */
export const ECHEVERIA_DEFAULT_GENOME: Record<string, number> = {
  // 叶序
  leafDensity: 0.62,
  rosetteCompact: 0.68,
  outerOpen: 0.42,
  phylloJitter: 0.06,
  // 叶形
  leafLength: 0.52,
  leafWidth: 0.62,
  leafThickness: 0.72,
  curvature: 0.48,
  tipSharpness: 0.55,
  openness: 0.5,
  // 颜色与质感
  baseHue: 0.4,
  stressHue: 0.35,
  farina: 0.15,
  edgeContrast: 0.55,
  gloss: 0.4,
  // 习性
  growthRate: 0.55,
  waterTolerance: 0.6,
  stressColorPropensity: 0.65,
  stretchPropensity: 0.4,
  droughtDecay: 0.6,
}

/**
 * 绚丽向预设（docs/08 §3）：短肥圆、密聚拢、强渐变、糖果色。
 * createWorld genomeBase 传入启用；与写实向并存。
 */
export const ECHEVERIA_VIVID_GENOME: Record<string, number> = {
  leafDensity: 0.78,
  rosetteCompact: 0.82,
  outerOpen: 0.3,
  leafLength: 0.4,
  leafWidth: 0.72,
  leafThickness: 0.9,
  curvature: 0.62,
  tipSharpness: 0.25,
  openness: 0.5,
  baseHue: 0.4,
  stressHue: 0.35,
  farina: 0.15,
  edgeContrast: 0.7,
  gloss: 0.5,
  growthRate: 0.55,
  waterTolerance: 0.6,
  stressColorPropensity: 0.8,
  stretchPropensity: 0.3,
  droughtDecay: 0.6,
}

/**
 * 个体抖动幅度（±，0~1 基因空间）。原则：
 * 直接决定叶数/轮廓的基因给大方差（growthRate/leafLength/leafDensity），
 * 色相给宽域（可见的颜色差异），
 * 观感微调类（phylloJitter/openness）保持中小幅。
 * 目标：联系表上"扫一眼能分清株与株"（M1 验收线）。
 */
const GENE_JITTER: Record<string, number> = {
  // 叶序
  leafDensity: 0.30,
  rosetteCompact: 0.22,
  outerOpen: 0.28,
  phylloJitter: 0.10,
  // 叶形
  leafLength: 0.28,
  leafWidth: 0.22,
  leafThickness: 0.18,
  curvature: 0.30,
  tipSharpness: 0.30,
  openness: 0.25,
  // 颜色与质感
  baseHue: 0.50,
  stressHue: 0.35,
  farina: 0.30,
  edgeContrast: 0.30,
  gloss: 0.30,
  // 习性（叶数差异的主驱动）
  growthRate: 0.38,
  waterTolerance: 0.25,
  stressColorPropensity: 0.30,
  stretchPropensity: 0.25,
  droughtDecay: 0.25,
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** 读基因：个体值缺失时回落默认集 */
function g(plant: PlantState, name: string): number {
  return plant.genome.values[name] ?? ECHEVERIA_DEFAULT_GENOME[name] ?? 0.5
}

export const ECHEVERIA: SpeciesDef = {
  id: 'echeveria',
  version: 1,

  createGenome(rng: Rng, baseTable?: Record<string, number>): Genome {
    const table = baseTable ?? ECHEVERIA_DEFAULT_GENOME
    const values: Record<string, number> = {}
    for (const [name, base] of Object.entries(table)) {
      // 每基因独立抖动幅度（联系表实测 ±6% 全员 13 叶 → 双胞胎，2026-09-30）
      const amp = GENE_JITTER[name] ?? 0.12
      values[name] = clamp01(base + (rng() - 0.5) * 2 * amp)
    }
    return { values }
  },

  /** 叶生命周期（04 §5）：出生 → 展开 → 维持 → 衰老 → 脱落 */
  growStep(plant: PlantState, env: EnvSample, dtMs: number, ctx: StepCtx): void {
    const simTime = ctx.simTime
    const seasonFactor = 0.7 + 0.3 * Math.cos(env.seasonPhase * Math.PI * 2) // TODO(M3)：按春秋型精调

    // 出叶节律：间隔 3~7 模拟日 × growthRate × 季节
    const intervalMs = lerp(7, 3, g(plant, 'growthRate')) * DAY / Math.max(0.4, seasonFactor)
    const nextLeafAt = plant.counters['nextLeafAt']
    if (nextLeafAt === undefined) {
      plant.counters['nextLeafAt'] = simTime + intervalMs / 2
    } else if (simTime >= nextLeafAt) {
      const alive = plant.leaves.filter((l) => l.droppedSimTime === undefined)
      if (alive.length < MAX_ALIVE) {
        plant.leaves.push({
          bornSimTime: simTime,
          ringIndex: 0,
          maturity: 0,
          turgor: Math.min(1, plant.water * 1.3),
          colorState: 0,
          damage: 0,
          rand: ctx.rng(),
        })
      }
      plant.counters['nextLeafAt'] = simTime + intervalMs
    }

    // 徒长（04 §6）：长期光照亏缺积累；光照充足缓慢恢复（形态记忆而非恢复已长叶）
    const deficit = Math.max(0, 0.38 - env.light) * (env.light > 0.02 ? 1 : 0.15) // 夜间亏缺降权：徒长看总日积光
    const drift = (deficit * 0.003 - env.light * 0.0014) * (dtMs / HOUR)
    plant.stretch = Math.max(0, Math.min(1, plant.stretch + drift))
    if (plant.stretch > 0.25 && plant.counters['stretch.seen'] === undefined) {
      plant.counters['stretch.seen'] = 1
      ctx.emit({ simTime, plantId: plant.id, kind: 'stretch.visible', tier: 'growth' })
    }

    // 每叶：成熟 / turgor / 应激色 / 衰老脱落
    const expandMs = EXPAND_DAYS * DAY
    for (const leaf of plant.leaves) {
      if (leaf.droppedSimTime !== undefined) continue
      const age = simTime - leaf.bornSimTime
      if (age >= LIFE_MS) {
        leaf.droppedSimTime = simTime
        ctx.emit({ simTime, plantId: plant.id, kind: 'leaf.dropped', tier: 'growth' })
        continue
      }
      leaf.maturity = Math.min(1, age / expandMs)
      leaf.turgor = Math.min(1, plant.water * 1.3)
      const target = clamp01(plant.stress.drought * 0.15 * g(plant, 'stressColorPropensity'))
      leaf.colorState += (target - leaf.colorState) * Math.min(1, 0.008 * (dtMs / HOUR))
    }

    // 清理早已脱落的叶（事实已记录在事件日志）
    if (plant.leaves.some((l) => l.droppedSimTime !== undefined && simTime - l.droppedSimTime > DROP_KEEP_MS)) {
      plant.leaves = plant.leaves.filter(
        (l) => l.droppedSimTime === undefined || simTime - l.droppedSimTime <= DROP_KEEP_MS,
      )
    }
  },

  /**
   * 莲座生长语法（总方案 §11.2 / 04 §4.2）：
   * Vogel 螺旋（最新叶在中心）+ 环倾角曲线 + 基因耦合（04 §3.5）。
   */
  morphology(plant: PlantState): OrganPose[] {
    const poses: OrganPose[] = []
    const alive = plant.leaves.filter((l) => l.droppedSimTime === undefined)
    const n = alive.length

    const compact = g(plant, 'rosetteCompact')
    const outerOpen = g(plant, 'outerOpen')
    const density = g(plant, 'leafDensity')
    const jitter = g(plant, 'phylloJitter')
    const lenGene = g(plant, 'leafLength')
    const wGene = g(plant, 'leafWidth')
    const tGene = g(plant, 'leafThickness')
    const curve = g(plant, 'curvature')

    const lengthBase = (14 + 16 * lenGene) * (1 - 0.35 * density) // 耦合：叶密 → 叶短
    // M1 真机反馈：45 天植株相对盆口（φ90mm）偏小，整体放大 ~35%
    const sizeScale = 1.5
    const innerTilt = 0.35 - 0.15 * compact
    const outerTilt = 0.62 + 0.3 * outerOpen

    for (let i = 0; i < n; i++) {
      const leaf = alive[i]!
      const k = n - 1 - i // 0 = 最新（中心）
      const f = n > 1 ? k / (n - 1) : 0
      const radius = 2 * Math.sqrt(k)
      const azimuth = k * GOLDEN_ANGLE + (leaf.rand - 0.5) * 2 * jitter
      const tilt =
        innerTilt +
        (outerTilt - innerTilt) * Math.sqrt(f) +
        (1 - leaf.turgor) * 0.2 +
        (1 - leaf.maturity) * 0.15
      const length = lengthBase * (0.55 + 0.45 * Math.sqrt(f)) * (0.25 + 0.75 * leaf.maturity) * sizeScale
      const width = length * (0.36 + 0.24 * wGene) * (1 + 0.15 * tGene) * (1 - 0.3 * plant.stretch) // 徒长：叶变稀 // 耦合：厚 → 宽
      poses.push({
        ring: Math.round(f * 5),
        tilt,
        azimuth,
        offset: radius * sizeScale * 0.4 * (1 + 0.35 * plant.stretch), // 效果叠加：节间拉长+收拢
        droop: (1 - leaf.turgor) * 0.2 + (1 - leaf.maturity) * 0.15,
        curl: curve,
        growth: leaf.maturity,
        length,
        width,
        thickness: width * (0.55 + 0.55 * tGene) * (1 - 0.2 * plant.stretch), // M2 反馈：加厚去塑料感
        colorState: leaf.colorState,
        turgor: leaf.turgor,
      })
    }
    return poses
  },
}

/** dev 风格预览：按预设表生成带抖动的基因组（Shift+V 切换写实/绚丽） */
export function makeJitteredGenome(
  rng: Rng,
  baseTable?: Record<string, number>,
): Genome {
  return ECHEVERIA.createGenome(rng, baseTable)
}
