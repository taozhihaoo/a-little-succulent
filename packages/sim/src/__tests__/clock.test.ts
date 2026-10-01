import { describe, expect, it } from 'vitest'
import { SIM_STEP_MS, floorToGrid, gridTarget, judgeWallDelta, nextBoundary, reanchorSimTime } from '../clock'
import type { WorldState } from '../world'

describe('步网格（02 §1.3）', () => {
  it('floorToGrid / nextBoundary / gridTarget 恒落在网格上', () => {
    const t = 1_780_000_000_123
    const f = floorToGrid(t)
    expect(f % SIM_STEP_MS).toBe(0)
    expect(nextBoundary(t) % SIM_STEP_MS).toBe(0)
    expect(nextBoundary(t)).toBe(f + SIM_STEP_MS)
    expect(gridTarget(t)).toBe(f)
  })
})

describe('时间异常保护（02 §1.4 / R4）', () => {
  it('回拨被识别且不产生负 delta', () => {
    expect(judgeWallDelta(1000, 500)).toEqual({
      status: 'rolled-back',
      observed: 500,
      lastSeen: 1000,
    })
  })

  it('正常前进返回非负增量', () => {
    const v = judgeWallDelta(1000, 1500)
    expect(v).toEqual({ status: 'ok', wallDelta: 500 })
  })
})

describe('超前再锚定（M5 长期成立）', () => {
  const makeWorld = (simTime: number): WorldState => ({
    formatVersion: 1,
    simulationVersion: 1,
    simTime,
    env: { placement: 'windowsill', utcOffsetMinutes: 480, hemisphere: 'north' },
    plants: [
      {
        id: 'p1',
        speciesId: 'echeveria',
        seed: 's1',
        genome: { values: {} },
        bornSimTime: simTime - 40 * 86_400_000,
        water: 0.5,
        stress: { light: 0, drought: 0, temp: 0 },
        stretch: 0,
        seasonPhase: 0.3,
        leaves: [
          { bornSimTime: simTime - 30 * 86_400_000, ringIndex: 0, maturity: 1, turgor: 1, colorState: 0, damage: 0, rand: 0.5 },
          { bornSimTime: simTime - 50 * 86_400_000, ringIndex: 1, maturity: 1, turgor: 1, colorState: 0, damage: 0, rand: 0.6, droppedSimTime: simTime - 10 * 86_400_000 },
        ],
        stems: [{ heightMm: 4, lignification: 0 }],
        counters: { nextLeafAt: simTime + 3 * 86_400_000, 'sign.offset.until': simTime + 86_400_000, 'stretch.seen': 1, 'water.low.active': 0 },
        signs: [{ id: 'offset', phase: 'lurking', strength: 0.1, startedSimTime: simTime - 86_400_000 }],
      },
    ],
  })

  it('超前 ≤48h 不触发', () => {
    const now = 1_800_000_000_000
    const w = makeWorld(now + 48 * 3_600_000)
    expect(reanchorSimTime(w, now)).toBe(0)
    expect(w.simTime).toBe(now + 48 * 3_600_000)
  })

  it('大幅超前时整体平移，时长语义不变，标记型计数器不动', () => {
    const now = 1_800_000_000_000
    const w = makeWorld(now + 800 * 86_400_000) // 超前 800 天
    const p = w.plants[0]!
    const ageBefore = w.simTime - p.bornSimTime
    const drift = reanchorSimTime(w, now)
    expect(drift).toBe(800 * 86_400_000)
    expect(w.simTime).toBe(now)
    expect(w.simTime - p.bornSimTime).toBe(ageBefore) // 苗龄不变
    expect(p.counters['nextLeafAt']).toBe(now + 3 * 86_400_000) // 冷却时间戳跟随平移
    expect(p.counters['stretch.seen']).toBe(1) // 标记型计数器不动
    expect(p.counters['water.low.active']).toBe(0)
    expect(p.leaves[1]!.droppedSimTime).toBe(now - 10 * 86_400_000) // 落时相对 simTime -10d → 相对 now 仍 -10d
    expect(p.signs![0]!.startedSimTime).toBe(now - 86_400_000)
  })
})
