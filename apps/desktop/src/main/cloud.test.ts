/** M3-13 事件日志多代归档测试：链式轮转、最老丢弃、摘要汇总。cloud.ts 不依赖 electron，可直接跑。 */
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LocalCloudAdapter } from './cloud'

const dirs: string[] = []

function makeAdapter(): { adapter: LocalCloudAdapter; dir: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'succulent-cloud-'))
  dirs.push(dir)
  // 阈值 300B：单条 ~60B 的事件一写就触发轮转
  return { adapter: new LocalCloudAdapter(dir, 300, 3), dir }
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('事件日志多代归档（M3-13）', () => {
  const fat = (i: number): string =>
    JSON.stringify({ kind: 'leaf.dropped', simTime: 1000 + i, payload: { pad: 'x'.repeat(320) } })

  it('轮转链：events.1/events.2 保留，更早代丢弃', () => {
    const { adapter, dir } = makeAdapter()
    for (let i = 0; i < 5; i++) {
      adapter.checkpoint(`{"eventCount":${i}}`, fat(i))
    }
    expect(existsSync(path.join(dir, 'events.jsonl'))).toBe(true)
    expect(existsSync(path.join(dir, 'events.1.jsonl'))).toBe(true)
    expect(existsSync(path.join(dir, 'events.2.jsonl'))).toBe(true)
    expect(existsSync(path.join(dir, 'events.3.jsonl'))).toBe(false) // 最多 2 个归档代
    // 最新归档（events.1）= 第 4 次写的事件
    expect(readFileSync(path.join(dir, 'events.1.jsonl'), 'utf8')).toContain('"simTime":1003')
    // 次新（events.2）= 第 3 次
    expect(readFileSync(path.join(dir, 'events.2.jsonl'), 'utf8')).toContain('"simTime":1002')
  })

  it('摘要：跨代聚合 kind 计数与时间范围，坏行容错', () => {
    const { adapter, dir } = makeAdapter()
    const pad = 'y'.repeat(320)
    const lines = [
      JSON.stringify({ kind: 'leaf.dropped', simTime: 100, payload: { pad } }),
      JSON.stringify({ kind: 'leafgo.rooted', simTime: 200, payload: { pad } }),
      '<<<corrupted>>>', // 单行损坏跳过
      JSON.stringify({ kind: 'leaf.dropped', simTime: 300, payload: { pad } }),
    ]
    adapter.checkpoint('{"eventCount":0}', lines.join('\n') + '\n')
    adapter.checkpoint('{"eventCount":1}', JSON.stringify({ kind: 'leaf.dropped', simTime: 400, payload: { pad } }))
    const summary = JSON.parse(readFileSync(path.join(dir, 'events-summary.json'), 'utf8')) as {
      total: number
      first: number | null
      last: number | null
      counts: Record<string, number>
    }
    expect(summary.counts['leaf.dropped']).toBe(2) // 归档代里的两条
    expect(summary.counts['leafgo.rooted']).toBe(1)
    expect(summary.total).toBe(3)
    expect(summary.first).toBe(100)
    expect(summary.last).toBe(300) // 摘要在轮转瞬间写：400 还在当前 events.jsonl，未归档
  })
})
