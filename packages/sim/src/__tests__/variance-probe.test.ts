import { expect, it } from 'vitest'
import { createEngine, createWorld } from '../engine'
import { ECHEVERIA } from '../species/echeveria'

const DAY = 86_400_000
const ENV = { placement: 'windowsill', utcOffsetMinutes: 480, hemisphere: 'north' } as const

it('100 株 60 天叶数分布（唯一性粗检）', () => {
  const counts: number[] = []
  const hues: number[] = []
  for (let i = 0; i < 100; i++) {
    const world = createWorld(`sheet-${String(i).padStart(3, '0')}`, 0, ENV)
    const engine = createEngine({ world })
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
