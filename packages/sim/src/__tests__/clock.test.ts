import { describe, expect, it } from 'vitest'
import { SIM_STEP_MS, floorToGrid, gridTarget, judgeWallDelta, nextBoundary } from '../clock'

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
