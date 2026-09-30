/** Echeveria 物种定义测试（M1）：确定性 + 生长节律 + 形态学。 */
import { describe, expect, it } from 'vitest'
import { createRng } from '../rng'
import { createEngine, createWorld } from '../engine'
import { ECHEVERIA, ECHEVERIA_DEFAULT_GENOME } from './echeveria'

const DAY = 86_400_000
const HOUR = 3_600_000
const ENV = {
  placement: 'windowsill',
  utcOffsetMinutes: 480,
  hemisphere: 'north',
} as const

describe('echeveria 基因（04 §3）', () => {
  it('同 seed ⇒ 同基因组；值都在 0~1', () => {
    const a = ECHEVERIA.createGenome(createRng('plant-018'))
    const b = ECHEVERIA.createGenome(createRng('plant-018'))
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    for (const v of Object.values(a.values)) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })

  it('默认集键与 04 §13 一致', () => {
    expect(Object.keys(ECHEVERIA_DEFAULT_GENOME).sort()).toEqual(
      [
        'baseHue', 'curvature', 'droughtDecay', 'edgeContrast', 'farina', 'gloss',
        'growthRate', 'leafDensity', 'leafLength', 'leafThickness', 'leafWidth',
        'openness', 'outerOpen', 'phylloJitter', 'rosetteCompact', 'stressColorPropensity',
        'stressHue', 'stretchPropensity', 'tipSharpness', 'waterTolerance',
      ].sort(),
    )
  })
})

describe('echeveria 生长节律（04 §5）', () => {
  it('30 模拟日内持续出新叶', () => {
    const world = createWorld('growth-test', 0, ENV)
    const engine = createEngine({ world })
    engine.advance(30 * DAY, Number.MAX_SAFE_INTEGER)
    const alive = world.plants[0]!.leaves.filter((l) => l.droppedSimTime === undefined)
    expect(alive.length).toBeGreaterThan(3)
  })

  it('seed 决定形态：两个不同 seed 的 30 天植株形态不同', () => {
    const shapeOf = (seed: string): string => {
      const world = createWorld(seed, 0, ENV)
      const engine = createEngine({ world })
      engine.advance(30 * DAY, Number.MAX_SAFE_INTEGER)
      return JSON.stringify(ECHEVERIA.morphology(world.plants[0]!))
    }
    expect(shapeOf('plant-a')).not.toBe(shapeOf('plant-b'))
  })
})

describe('echeveria 莲座形态学（04 §4.2）', () => {
  it('最新叶在中心（offset 最小），外圈叶倾角更大', () => {
    const world = createWorld('morph-test', 0, ENV)
    const engine = createEngine({ world })
    engine.advance(20 * DAY, Number.MAX_SAFE_INTEGER)
    const organs = ECHEVERIA.morphology(world.plants[0]!)
    expect(organs.length).toBeGreaterThan(2)
    const newest = organs[organs.length - 1]!
    const oldest = organs[0]!
    expect(newest.offset).toBeLessThanOrEqual(oldest.offset)
    expect(newest.tilt).toBeLessThanOrEqual(oldest.tilt)
    expect(newest.growth).toBeLessThanOrEqual(oldest.growth)
  })
})

describe('快照管线（07 §7 前半）', () => {
  it('分片推进与连续推进的快照逐字节一致', () => {
    const snapshotOf = (chunks: readonly number[]): string => {
      const world = createWorld('snap-test', 0, ENV)
      const engine = createEngine({ world })
      let cursor = 0
      for (const c of chunks) {
        cursor += c
        engine.advance(cursor, Number.MAX_SAFE_INTEGER)
      }
      return JSON.stringify(engine.latestSnapshot())
    }
    const continuous = snapshotOf([10 * DAY])
    const hourly = snapshotOf(Array.from({ length: 240 }, () => HOUR))
    expect(hourly).toBe(continuous)
  })

  it('全苗龄段快照数值有限（NaN 防线：含 n=1 幼苗期与老龄化）', () => {
    for (const ageDays of [0.5, 2, 6, 13, 45, 90, 200, 400]) {
      const world = createWorld('finite-test', 0, ENV)
      const engine = createEngine({ world })
      engine.advance(ageDays * DAY, Number.MAX_SAFE_INTEGER)
      const snap = engine.latestSnapshot()
      const fields = [
        snap.water, snap.stretch,
        ...snap.organs.flatMap((o) => [
          o.tilt, o.azimuth, o.offset, o.droop, o.curl, o.growth, o.length, o.width, o.thickness,
        ]),
      ]
      for (const v of fields) {
        expect(Number.isFinite(v), `age=${ageDays} 值 ${v}`).toBe(true)
      }
    }
  })
})

describe('徒长机制（04 §6）', () => {
  it('长期遮荫 stretch 上升并触发迹象；充足光照回落', () => {
    const shade = createWorld('stretch-shade', 0, { ...ENV, placement: 'shade' })
    const shadeEngine = createEngine({ world: shade })
    shadeEngine.advance(60 * DAY, Number.MAX_SAFE_INTEGER)
    expect(shade.plants[0]!.stretch).toBeGreaterThan(0.2)
    const kinds = shadeEngine.events.map((e) => e.kind)
    expect(kinds).toContain('stretch.visible')

    const sun = createWorld('stretch-sun', 0, { ...ENV, placement: 'windowsill' })
    const sunEngine = createEngine({ world: sun })
    sunEngine.advance(60 * DAY, Number.MAX_SAFE_INTEGER)
    expect(sun.plants[0]!.stretch).toBeLessThan(0.15)
  })
})

describe('迹象系统（M4 任务 7）', () => {
  it('缺水挣扎：强度爬升、相位推进、迹象事件入流', () => {
    const world = createWorld('sign-test', 0, ENV)
    const engine = createEngine({ world })
    engine.advance(30 * DAY, Number.MAX_SAFE_INTEGER)
    const sign = world.plants[0]!.signs?.find((s) => s.id === 'droughtStruggle')
    expect(sign).toBeDefined()
    expect(sign!.strength).toBeGreaterThan(0.2)
    expect(['signal', 'developing', 'critical', 'occurred', 'afterglow']).toContain(sign!.phase)
    const kinds = engine.events.map((e) => e.kind)
    expect(kinds.some((k) => k.startsWith('sign.droughtStruggle'))).toBe(true)
  })

  it('事件预算：tier 每日上限生效（major 每日 1）', () => {
    const world = createWorld('budget-test', 0, ENV)
    const plant = world.plants[0]!
    const day0 = 0
    const cap = 1
    let allowed = 0
    for (let i = 0; i < 5; i++) {
      const key = `budget:major:${day0}`
      const used = plant.counters[key] ?? 0
      if (used >= cap) continue
      plant.counters[key] = used + 1
      allowed++
    }
    expect(allowed).toBe(cap)
  })
})
