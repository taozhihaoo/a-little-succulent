/** M6-3/M7：种子码 → 新苗的共享导入逻辑（dev 控制台与正式版 Journal 共用）。 */
import type { DecodedSeedCode } from '@succulent/sim'

export interface SeedlingPlant {
  id: string
  speciesId: string
  seed: string
  genome: { values: Record<string, number> }
  bornSimTime: number
  water: number
  stress: { light: number; drought: number; temp: number }
  stretch: number
  seasonPhase: number
  leaves: {
    bornSimTime: number
    ringIndex: number
    maturity: number
    turgor: number
    colorState: number
    damage: number
    rand: number
  }[]
  stems: { heightMm: number; lignification: number }[]
  counters: Record<string, number>
}

/** Slot 上限（总方案 §34：首发少 Slot） */
export const SLOT_CAP = 8

/** 追加一株种子码重建苗。返回错误文案（null = 成功）。苗龄从当下重新开始（记录随迁不可行）。 */
export function appendSeedling(plants: SeedlingPlant[], decoded: DecodedSeedCode, simTime: number): string | null {
  if (plants.length >= SLOT_CAP) return '盆已满（最多 8 株）'
  plants.push({
    id: `${decoded.seed}-shared${plants.length}`,
    speciesId: decoded.speciesId,
    seed: decoded.seed,
    genome: decoded.genome,
    bornSimTime: simTime,
    water: 0.7,
    stress: { light: 0, drought: 0, temp: 0 },
    stretch: 0,
    seasonPhase: 0,
    leaves: [
      { bornSimTime: simTime, ringIndex: 0, maturity: 0.3, turgor: 1, colorState: 0, damage: 0, rand: 0.5 },
    ],
    stems: [{ heightMm: 2, lignification: 0 }],
    counters: {},
  })
  return null
}
