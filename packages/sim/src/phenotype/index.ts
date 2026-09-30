/** PhenotypeSnapshot（02 §3.3）：模拟 → 渲染的唯一桥梁。纯参数，不含网格。 */
import type { PlantState } from '../world'
import type { OrganPose } from '../species'

export interface PhenotypeSnapshot {
  plantId: string
  simTime: number
  generatorVersion: number
  /** 0~1 植株水分（影响材质 roughness / 褶皱，04 §6） */
  water: number
  stretch: number
  organs: OrganPose[]
}

/** TODO(M1)：由 SpeciesDef.morphology + 全局材质参数组装（04 §4 / §10）。 */
export function derivePhenotype(
  plant: PlantState,
  simTime: number,
  generatorVersion: number,
): PhenotypeSnapshot {
  void plant
  void simTime
  void generatorVersion
  throw new Error('derivePhenotype: M1 落地（04 §4）')
}
