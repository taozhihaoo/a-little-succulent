import { describe, expect, it } from 'vitest'
import { createRng } from '../rng'

describe('sfc32 命名流（I1 确定性）', () => {
  it('同 seed ⇒ 同序列', () => {
    const a = createRng('plant-018')
    const b = createRng('plant-018')
    expect([a(), a(), a(), a()]).toEqual([b(), b(), b(), b()])
  })

  it('不同 seed ⇒ 不同序列', () => {
    const a = createRng('plant-018')
    const b = createRng('plant-019')
    expect([a(), a()]).not.toEqual([b(), b()])
  })

  it('输出落在 [0, 1)', () => {
    const r = createRng('x')
    for (let i = 0; i < 1000; i++) {
      const v = r()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})
