/** PhenotypeSnapshot（02 §3.3）：模拟 → 渲染的唯一桥梁。纯参数，不含网格。 */
import { paletteFor } from '../species/palettes'
import { sampleEnv } from '../env'
import type { OrganPose } from '../species'
import type { EnvConfig } from '../world'
import { getSpecies } from '../species/registry'
import type { PlantState } from '../world'

export interface SnapshotMaterial {
  /** 0~1 RGB */
  baseColor: [number, number, number]
  stressColor: [number, number, number]
  farina: number
  gloss: number
  edgeContrast: number
  /** 0~1 全株应激色强度（外圈老叶权重高；M2 渐变的总量） */
  stressAmount: number

  /** 内圈嫩叶色（0~1 RGB） */
  youngColor: [number, number, number]
  /** 外圈深叶色（0~1 RGB） */
  matureColor: [number, number, number]
  /** 锦化表达量 0~1（M6-2：渲染侧奶油条纹强度；基因 ≥0.5 起效） */
  variegata: number
}

export interface SnapshotShape {
  tipSharpness: number
  openness: number
  curvature: number
}

export interface PhenotypeSnapshot {
  plantId: string
  simTime: number
  generatorVersion: number
  /** 0~1 昼夜相位（0 午夜 / 0.5 正午；由 utcOffset 换算，02 §2.2） */
  dayPhase: number
  /** 0~1 植株水分（影响材质 roughness / 褶皱，04 §6） */
  water: number
  stretch: number
  /** 花剑存在（M4 任务 10 迹象发生 → M5 渲染花剑几何） */
  spike: boolean
  /** 茎状态（M5-2 老桩） */
  stem: { heightMm: number; lignification: number }
  /** 开花进度 0~1（M5-1） */
  spikeBloom: number
  /** 凋谢标记 */
  spikeWithered: boolean
  material: SnapshotMaterial
  shape: SnapshotShape
  organs: OrganPose[]
}

/** HSL → RGB（0~1），纯函数 */

/**
 * 状态 → 表现（M1 实现）。
 * TODO(M2)：应激色空间分布（沿 aT 渐变）与粉霜 mask 在渲染侧用 aT/aC 属性完成，
 * 这里提供基因级参数即可。
 */
export function derivePhenotype(
  plant: PlantState,
  simTime: number,
  generatorVersion: number,
  env: EnvConfig,
): PhenotypeSnapshot {
  const species = getSpecies(plant.speciesId)
  const g = (name: string): number => plant.genome.values[name] ?? 0.5
  // 全株应激色强度：外圈（老）叶权重更高（04 §7：外圈先着色）
  const alive = plant.leaves.filter((l) => l.droppedSimTime === undefined)
  let weighted = 0
  let weightSum = 0
  for (let i = 0; i < alive.length; i++) {
    const w = 0.5 + (i / Math.max(1, alive.length - 1)) * 0.5 // 老叶（数组前部）权重高
    weighted += alive[i]!.colorState * w
    weightSum += w
  }
  const stressAmount = weightSum > 0 ? Math.min(1, weighted / weightSum) : 0
  // 基因红边晕：绚丽的底色，不依赖应激（真实拟石莲的粉边是天生）
  const blush = g('edgeContrast') * 0.3
  const stressWithBlush = Math.min(1, stressAmount + blush)
    // 旧存档无 palette 基因：默认 0 = 自然绿（g() 的 0.5 缺省会命中白色板）
    const pal = paletteFor(plant.genome.values['palette'] ?? 0)
    const mixC = (
      a: [number, number, number],
      b: [number, number, number],
      t: number,
    ): [number, number, number] => [
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t,
    ]

  return {
    plantId: plant.id,
    simTime,
    generatorVersion,
    dayPhase: sampleEnv(simTime, env).dayPhase,
    water: plant.water,
    stretch: plant.stretch,
    spike: plant.spike ?? false,
    stem: { heightMm: plant.stems[0]?.heightMm ?? 2, lignification: plant.stems[0]?.lignification ?? 0 },
    spikeBloom: plant.spikeBloom ?? 0,
    spikeWithered: plant.spikeWithered ?? false,
    material: {
      baseColor: pal.base,
      // 内浅外深色阶幅度随 edgeContrast 增幅（实拍对照 docs/08 §5：绚丽向内圈奶黄/外圈深色落差明显）
      youngColor: mixC(pal.base, [0.95, 0.95, 0.8], 0.3 + 0.35 * (plant.genome.values['edgeContrast'] ?? 0.55)),
      matureColor: mixC(pal.base, [0.12, 0.16, 0.12], 0.3 + 0.35 * (plant.genome.values['edgeContrast'] ?? 0.55)),
      stressColor: pal.tip,
      farina: g('farina'),
      gloss: g('gloss'),
      edgeContrast: g('edgeContrast'),
      stressAmount: stressWithBlush,
      // 锦化（M6-2）：0.5 起效、0.85 满表达（与 genetics 稀有座位表达值对齐）
      variegata: Math.max(0, Math.min(1, ((plant.genome.values['variegata'] ?? 0) - 0.5) / 0.35)),
    },
    shape: { tipSharpness: g('tipSharpness'), openness: g('openness'), curvature: g('curvature') },
    organs: species.morphology(plant),
  }
}
