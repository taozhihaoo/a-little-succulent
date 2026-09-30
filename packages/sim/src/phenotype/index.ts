/** PhenotypeSnapshot（02 §3.3）：模拟 → 渲染的唯一桥梁。纯参数，不含网格。 */
import type { OrganPose } from '../species'
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
  /** 0~1 植株水分（影响材质 roughness / 褶皱，04 §6） */
  water: number
  stretch: number
  material: SnapshotMaterial
  shape: SnapshotShape
  organs: OrganPose[]
}

/** HSL → RGB（0~1），纯函数 */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l)
  const f = (n: number): number => {
    const k = (n + h * 12) % 12
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
  }
  return [f(0), f(8), f(4)]
}

/**
 * 状态 → 表现（M1 实现）。
 * TODO(M2)：应激色空间分布（沿 aT 渐变）与粉霜 mask 在渲染侧用 aT/aC 属性完成，
 * 这里提供基因级参数即可。
 */
export function derivePhenotype(
  plant: PlantState,
  simTime: number,
  generatorVersion: number,
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
  return {
    plantId: plant.id,
    simTime,
    generatorVersion,
    water: plant.water,
    stretch: plant.stretch,
    material: {
      baseColor: hslToRgb(0.28 + 0.17 * g('baseHue'), 0.48, 0.42),
      stressColor: hslToRgb(0.83 + 0.12 * g('stressHue'), 0.55, 0.6),
      farina: g('farina'),
      gloss: g('gloss'),
      edgeContrast: g('edgeContrast'),
      stressAmount,
    },
    shape: { tipSharpness: g('tipSharpness'), openness: g('openness'), curvature: g('curvature') },
    organs: species.morphology(plant),
  }
}
