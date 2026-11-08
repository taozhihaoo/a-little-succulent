/** PlantRenderer 复现测试：完整管线（世界 → 快照 → 场景）中逐网格排查 NaN。 */
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { createEngine, createWorld } from '@succulent/sim'
import { PlantRenderer } from './plant'

const DAY = 86_400_000
const ENV = {
  placement: 'windowsill',
  utcOffsetMinutes: 480,
  hemisphere: 'north',
} as const

function label(geometry: THREE.BufferGeometry): string {
  if (geometry instanceof THREE.LatheGeometry) return 'pot(lathe)'
  if (geometry instanceof THREE.CylinderGeometry) return 'soil/stem(cylinder)'
  return 'leaf(buffer)'
}

function scan(scene: THREE.Scene): string[] {
  const bad: string[] = []
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    const pos = mesh.geometry.getAttribute('position')
    for (let i = 0; i < pos.count; i++) {
      if (!Number.isFinite(pos.getX(i)) || !Number.isFinite(pos.getY(i)) || !Number.isFinite(pos.getZ(i))) {
        bad.push(`${label(mesh.geometry)} uuid=${mesh.geometry.uuid} vertex=${i}`)
        break
      }
    }
  })
  return bad
}

describe('PlantRenderer 完整管线 NaN 排查', () => {
  it('45 天植株场景无 NaN 几何', () => {
    const world = createWorld('repro-test', Date.now() - 45 * DAY, ENV)
    const engine = createEngine({ world })
    engine.advance(Date.now(), Number.MAX_SAFE_INTEGER)
    const scene = new THREE.Scene()
    const pr = new PlantRenderer(scene)
    pr.update(engine.latestSnapshot())
    expect(scan(scene)).toEqual([])
  })

  it('幼苗（6 天）场景无 NaN 几何', () => {
    const world = createWorld('repro-young', Date.now() - 6 * DAY, ENV)
    const engine = createEngine({ world })
    engine.advance(Date.now(), Number.MAX_SAFE_INTEGER)
    const scene = new THREE.Scene()
    const pr = new PlantRenderer(scene)
    pr.update(engine.latestSnapshot())
    expect(scan(scene)).toEqual([])
  })

  it('形状参数变化后叶片必须换几何（旧几何已 dispose，继续引用会画不出来）', () => {
    const world = createWorld('repro-shape', Date.now() - 45 * DAY, ENV)
    const engine = createEngine({ world })
    engine.advance(Date.now(), Number.MAX_SAFE_INTEGER)
    const scene = new THREE.Scene()
    const pr = new PlantRenderer(scene)
    const snap = engine.latestSnapshot()
    pr.update(snap)
    const leafGeometries = (): THREE.BufferGeometry[] => {
      const out: THREE.BufferGeometry[] = []
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (mesh.isMesh && mesh.geometry?.getAttribute('aT')) out.push(mesh.geometry)
      })
      return out
    }
    const before = leafGeometries()
    expect(before.length).toBe(snap.organs.length)

    // 叶形参数变化（同一器官数）→ 几何必须重建并回贴到已有网格
    pr.update({ ...snap, shape: { ...snap.shape, tipSharpness: 0.95, curvature: 0.05 } })
    const after = leafGeometries()
    expect(after.length).toBe(snap.organs.length)
    expect(after[0]!.uuid).not.toBe(before[0]!.uuid)
    expect(new Set(after.map((g) => g.uuid)).size).toBe(1)
  })
})
