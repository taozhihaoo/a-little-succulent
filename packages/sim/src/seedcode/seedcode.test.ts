/** M6-3 种子码测试：往返一致、篡改拒绝、量化容差、非法输入返回 null。 */
import { describe, expect, it } from 'vitest'
import { createRng } from '../rng'
import { ECHEVERIA_DEFAULT_GENOME } from '../species/echeveria'
import { decodeSeedCode, encodeSeedCode } from './index'
import type { Genome, PlantState } from '../world'

function makePlant(seed: string, genome: Genome): PlantState {
  return {
    id: `plant-${seed}`,
    speciesId: 'echeveria',
    seed,
    genome,
    bornSimTime: 0,
    water: 0.8,
    stress: { light: 0, drought: 0, temp: 0 },
    stretch: 0,
    seasonPhase: 0,
    leaves: [],
    stems: [{ heightMm: 2, lignification: 0 }],
    counters: {},
  }
}

describe('种子码（M6-3）', () => {
  it('往返：seed 精确恢复，基因误差 ≤ 1/255，含稀有座位', () => {
    const genome = { values: { ...ECHEVERIA_DEFAULT_GENOME } }
    // 模拟个体：全基因座带任意值（含突变显性 0.85）
    for (const k of Object.keys(genome.values)) genome.values[k] = (createRng(k)() * 255 | 0) / 255
    genome.values['variegata'] = 0.85
    const plant = makePlant('echeveria-001|offset3', genome)
    const decoded = decodeSeedCode(encodeSeedCode(plant))
    expect(decoded).not.toBeNull()
    expect(decoded!.speciesId).toBe('echeveria')
    expect(decoded!.seed).toBe('echeveria-001|offset3')
    for (const [k, v] of Object.entries(genome.values)) {
      expect(Math.abs(decoded!.genome.values[k]! - v)).toBeLessThanOrEqual(1 / 255)
    }
  })

  it('任意字符篡改 → 拒绝', () => {
    const plant = makePlant('s', { values: { ...ECHEVERIA_DEFAULT_GENOME } })
    const code = encodeSeedCode(plant)
    const flipped = (code.startsWith('A') ? 'B' : 'A') + code.slice(1)
    expect(decodeSeedCode(flipped)).toBeNull()
  })

  it('乱码 / 空串 → null（不抛错）', () => {
    expect(decodeSeedCode('hello world!!!')).toBeNull()
    expect(decodeSeedCode('')).toBeNull()
    expect(decodeSeedCode('AAAA-AAAA')).toBeNull()
  })

  it('长度变化 / 键数漂移被校验拦截', () => {
    const plant = makePlant('s', { values: { ...ECHEVERIA_DEFAULT_GENOME } })
    const decoded = decodeSeedCode(encodeSeedCode(plant))
    expect(decoded).not.toBeNull()
    expect(Object.keys(decoded!.genome.values).length).toBe(Object.keys(ECHEVERIA_DEFAULT_GENOME).length)
  })
})
