/** PhenotypeSnapshot（02 §3.3）：模拟 → 渲染的唯一桥梁。纯参数，不含网格。 */
import type { OrganPose } from '../species'
import type { PlantState } from '../world'

export interface PhenotypeSnapshot {
  plantId: string
  simTime: number
  generatorVersion: number
  /** 0~1 植株水分（影响材质 roughness / 褶皱，04 §6） */
  water: number
  stretch: number
  organs: OrganPose[]
}

const GOLDEN_ANGLE = 2.399963229728653

/**
 * S2 占位派生：叶姿态 = 环倾角 + 黄金角方位 + turgor 垂头。
 * TODO(M1)：按 04 §4 替换为真实莲座形态学（环曲线 / 尺寸曲线 / 粉霜参数）。
 */
export function derivePhenotype(
  plant: PlantState,
  simTime: number,
  generatorVersion: number,
): PhenotypeSnapshot {
  const organs: OrganPose[] = []
  for (let i = 0; i < plant.leaves.length; i++) {
    const leaf = plant.leaves[i]!
    organs.push({
      ring: leaf.ringIndex,
      tilt: 0.35 + 0.15 * leaf.ringIndex,
      azimuth: i * GOLDEN_ANGLE,
      droop: (1 - leaf.turgor) * 0.25 + (1 - leaf.maturity) * 0.1,
      curl: 0.3,
      growth: leaf.maturity,
      length: 22 * leaf.maturity,
      width: 12 * leaf.maturity,
      thickness: 6,
    })
  }
  return {
    plantId: plant.id,
    simTime,
    generatorVersion,
    water: plant.water,
    stretch: plant.stretch,
    organs,
  }
}
