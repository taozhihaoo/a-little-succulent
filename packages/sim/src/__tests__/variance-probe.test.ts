import { expect, it } from 'vitest'
import { createEngine, createWorld } from '../engine'

const DAY = 86_400_000
const ENV = { placement: 'windowsill', utcOffsetMinutes: 480, hemisphere: 'north' } as const

it('100 株 60 天叶数分布（唯一性粗检）', () => {
  const counts: number[] = []
  const hues: number[] = []
  for (let i = 0; i < 100; i++) {
    const world = createWorld(`sheet-${String(i).padStart(3, '0')}`, 0, ENV)
    const engine = createEngine({ world })
    // 照料语义：每 10 天浇水一次（生长停滞只有无人照料才发生）
    for (let d = 0; d < 60; d += 10) {
      engine.advance(d * DAY, Number.MAX_SAFE_INTEGER)
      world.plants[0]!.water = 0.9
    }
    engine.advance(60 * DAY, Number.MAX_SAFE_INTEGER)
    counts.push(world.plants[0]!.leaves.filter((l) => l.droppedSimTime === undefined).length)
    hues.push(Math.round((world.plants[0]!.genome.values['baseHue'] ?? 0) * 20))
  }
  const uniqueCounts = new Set(counts)
  const uniqueHues = new Set(hues)
  console.log(`leaf counts: min=${Math.min(...counts)} max=${Math.max(...counts)} distinct=${uniqueCounts.size}`)
  console.log(`baseHue buckets distinct=${uniqueHues.size}/21`)
  expect(uniqueCounts.size).toBeGreaterThan(4)
})
