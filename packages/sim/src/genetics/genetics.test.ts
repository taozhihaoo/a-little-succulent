/** M6-1 杂交遗传测试：父本选择确定性 + 基因座混合 + 引擎集成（cross.bred 事件）。 */
import { describe, expect, it } from 'vitest'
import { createRng } from '../rng'
import { createEngine, createWorld } from '../engine'
import { offspringGenetics, pickFather } from './index'
import type { PlantState } from '../world'

const DAY = 86_400_000
const ENV = {
  placement: 'windowsill',
  utcOffsetMinutes: 480,
  hemisphere: 'north',
} as const

/** 造一株指定状态的植株（不走生长，直接构造测试夹具） */
function makePlant(id: string, seed: string, leafCount: number, spike: boolean, geneValue = 0.3): PlantState {
  return {
    id,
    speciesId: 'echeveria',
    seed,
    genome: { values: { leafLength: geneValue, growthRate: geneValue } },
    bornSimTime: 0,
    water: 0.8,
    stress: { light: 0, drought: 0, temp: 0 },
    stretch: 0,
    seasonPhase: 0,
    leaves: Array.from({ length: leafCount }, (_, i) => ({
      bornSimTime: 0,
      ringIndex: 0,
      maturity: 1,
      turgor: 1,
      colorState: 0,
      damage: 0,
      rand: i * 0.1,
    })),
    stems: [{ heightMm: 2, lignification: 0 }],
    counters: {},
    spike,
  }
}

describe('pickFather（M6-1 父本选择）', () => {
  it('只考虑开花株；取活叶最多者；排除母株', () => {
    const mother = makePlant('m', 's0', 10, true)
    const notSpike = makePlant('a', 's1', 40, false) // 叶最多但没开花 → 不可作父本
    const spikeSmall = makePlant('b', 's2', 8, true)
    expect(pickFather([mother, notSpike, spikeSmall], mother)?.id).toBe('b')
    expect(pickFather([mother, notSpike], mother)).toBeUndefined() // 无开花株 → 克隆
  })

  it('平局取序靠前者（确定性）', () => {
    const mother = makePlant('m', 's0', 10, true)
    const a = makePlant('a', 's1', 12, true)
    const b = makePlant('b', 's2', 12, true)
    expect(pickFather([mother, a, b], mother)?.id).toBe('a')
  })
})

describe('offspringGenetics（M6-1 基因座混合）', () => {
  it('杂交：每个基因座取双亲之一；键为并集', () => {
    const rng = createRng('cross-test')
    const mother = makePlant('m', 's0', 5, true, 0.2)
    mother.genome.values['palette'] = 0.9 // 母本独有键
    const father = makePlant('f', 's1', 5, true, 0.8)
    father.genome.values['gloss'] = 0.1 // 父本独有键
    const { genome, fatherId } = offspringGenetics(mother, father, rng)
    expect(fatherId).toBe('f')
    expect(Object.keys(genome.values).sort()).toEqual(['gloss', 'growthRate', 'leafLength', 'palette'].sort())
    expect(genome.values['leafLength']).toBeOneOf([0.2, 0.8])
    expect(genome.values['palette']).toBe(0.9) // 单亲独有 → 必传
    expect(genome.values['gloss']).toBe(0.1)
  })

  it('克隆：无父本时完整复制母株基因', () => {
    const rng = createRng('clone-test')
    const mother = makePlant('m', 's0', 5, false, 0.42)
    const { genome, fatherId } = offspringGenetics(mother, undefined, rng)
    expect(fatherId).toBeUndefined()
    expect(genome.values).toEqual(mother.genome.values)
    expect(genome.values).not.toBe(mother.genome.values) // 是拷贝，不是共享引用
  })

  it('确定性：同输入同 rng 起点必得同一子代', () => {
    const mother = makePlant('m', 's0', 5, true, 0.2)
    const father = makePlant('f', 's1', 5, true, 0.8)
    const a = offspringGenetics(mother, father, createRng('det'))
    const b = offspringGenetics(mother, father, createRng('det'))
    expect(a.genome.values).toEqual(b.genome.values)
    expect(a.fatherId).toBe(b.fatherId)
  })
})

describe('杂交集成（M6-1）：叶插子代混合同盆开花父本', () => {
  it('两株并存且父本开花 → 子代基因混合 + cross.bred 事件', () => {
    const world = createWorld('cross-integration', 0, ENV)
    const engine = createEngine({ world })
    const mother = world.plants[0]!
    const father = makePlant(mother.id + '-offset1', mother.seed + '|offset1', 20, true, 0.9)
    father.bornSimTime = 0
    world.plants.push(father)

    // 给母株一片躺够 20 天的脱落叶 → 触发叶插
    mother.leaves.push({
      bornSimTime: -40 * DAY,
      ringIndex: 0,
      maturity: 1,
      turgor: 1,
      colorState: 0,
      damage: 0,
      rand: 0.5,
      droppedSimTime: -25 * DAY,
    })
    mother.water = 0.9
    engine.advance(1 * DAY, Number.MAX_SAFE_INTEGER)

    expect(world.plants.length).toBeGreaterThanOrEqual(3) // 母+父+叶插子
    const child = world.plants[2]!
    const bred = engine.events.filter((e) => e.kind === 'cross.bred')
    expect(bred.length).toBeGreaterThanOrEqual(1)
    // 子代共享键 leafLength 必取双亲之一（父本 0.9，母本≠0.9）
    expect(child.genome.values['leafLength']).toBeOneOf([mother.genome.values['leafLength'], 0.9])
    // 确定性：同夹具重放得到相同子代基因
    const world2 = createWorld('cross-integration', 0, ENV)
    const engine2 = createEngine({ world: world2 })
    const mother2 = world2.plants[0]!
    const father2 = makePlant(mother2.id + '-offset1', mother2.seed + '|offset1', 20, true, 0.9)
    father2.bornSimTime = 0
    world2.plants.push(father2)
    mother2.leaves.push({
      bornSimTime: -40 * DAY,
      ringIndex: 0,
      maturity: 1,
      turgor: 1,
      colorState: 0,
      damage: 0,
      rand: 0.5,
      droppedSimTime: -25 * DAY,
    })
    mother2.water = 0.9
    engine2.advance(1 * DAY, Number.MAX_SAFE_INTEGER)
    expect(world2.plants[2]!.genome.values['leafLength']).toBe(child.genome.values['leafLength'])
  })
})
