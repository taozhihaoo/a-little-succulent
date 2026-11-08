/** 叶片几何回归测试：任何合法形状参数下都不允许产生 NaN 顶点（b021f0b 的回归防线）。 */
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { buildLeafGeometry } from './leaf'

function hasNaN(geometry: THREE.BufferGeometry): boolean {
  const pos = geometry.getAttribute('position')
  for (let i = 0; i < pos.count; i++) {
    if (!Number.isFinite(pos.getX(i)) || !Number.isFinite(pos.getY(i)) || !Number.isFinite(pos.getZ(i))) {
      return true
    }
  }
  const sphere = geometry.boundingSphere ?? geometry.computeBoundingSphere()
  void sphere
  return !Number.isFinite(geometry.boundingSphere?.radius ?? 0)
}

describe('buildLeafGeometry（04 §4.1）', () => {
  it('全参数网格下顶点与包围球均有限', () => {
    for (const tipSharpness of [0, 0.25, 0.5, 0.75, 1]) {
      for (const openness of [0, 0.5, 1]) {
        for (const curvature of [0, 0.5, 1]) {
          const geometry = buildLeafGeometry({ tipSharpness, openness, curvature })
          expect(hasNaN(geometry)).toBe(false)
          geometry.dispose()
        }
      }
    }
  })

  it('叶片是封闭实体（每条边恰被两个三角形共享）——薄片会在背面被剔除后"凭空消失"', () => {
    const geometry = buildLeafGeometry({ tipSharpness: 0.55, openness: 0.5, curvature: 0.5 })
    const index = geometry.getIndex()
    expect(index).not.toBeNull()
    const edges = new Map<string, number>()
    for (let i = 0; i < index!.count; i += 3) {
      const tri = [index!.getX(i), index!.getX(i + 1), index!.getX(i + 2)]
      for (let e = 0; e < 3; e++) {
        const a = tri[e]!
        const b = tri[(e + 1) % 3]!
        const key = a < b ? `${a}-${b}` : `${b}-${a}`
        edges.set(key, (edges.get(key) ?? 0) + 1)
      }
    }
    const open = [...edges.values()].filter((n) => n !== 2)
    expect(open).toEqual([])
    geometry.dispose()
  })

  it('叶片有厚度：z 向跨度非零且包含前后两侧', () => {
    const geometry = buildLeafGeometry({ tipSharpness: 0.5, openness: 0.5, curvature: 0.4 })
    const pos = geometry.getAttribute('position')
    let minZ = Number.POSITIVE_INFINITY
    let maxZ = Number.NEGATIVE_INFINITY
    for (let i = 0; i < pos.count; i++) {
      minZ = Math.min(minZ, pos.getZ(i))
      maxZ = Math.max(maxZ, pos.getZ(i))
    }
    expect(maxZ - minZ).toBeGreaterThan(0.1)
    expect(minZ).toBeLessThan(0)
    expect(maxZ).toBeGreaterThan(0)
    geometry.dispose()
  })

  it('shader 需要的顶点属性齐全（aT / aC / aU）', () => {
    const geometry = buildLeafGeometry({ tipSharpness: 0.5, openness: 0.5, curvature: 0.5 })
    for (const name of ['aT', 'aC', 'aU']) {
      const attr = geometry.getAttribute(name)
      expect(attr, name).toBeDefined()
      expect(attr.count).toBe(geometry.getAttribute('position').count)
    }
    geometry.dispose()
  })
})
