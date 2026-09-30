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
})
