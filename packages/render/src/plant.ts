/**
 * PlantRenderer（07 §4）：消费 PhenotypeSnapshot 更新莲座、茎、盆。
 * 规则：只读快照，永不反推植物状态；器官数量变化时重建，否则只更新变换。
 * M2：三档叶色变体（嫩/基/深）+ 露珠微事件。
 */
import * as THREE from 'three'
import type { PhenotypeSnapshot } from '@succulent/sim'
import { buildLeafGeometry } from './leaf'
import { applyLeafShader, type LeafMaterialUniforms } from './leaf-material'
import { DewLayer } from './dew'

const SOIL_Y = 4

interface LeafVariant {
  material: THREE.MeshPhysicalMaterial
  u: LeafMaterialUniforms
  stressMul: number
}

export class PlantRenderer {
  readonly group = new THREE.Group()
  readonly dew: DewLayer | undefined
  private readonly leafGroup = new THREE.Group()
  private readonly meshes: THREE.Mesh[] = []
  private readonly variants: LeafVariant[]
  private leafGeometry: THREE.BufferGeometry | undefined
  private geometryKey = ''
  private lastOrganCount = -1

  constructor(parent: THREE.Object3D, withDew = true) {
    const base = new THREE.MeshPhysicalMaterial({
      color: 0x7da87b,
      roughness: 0.62,
      sheen: 0.08,
      sheenRoughness: 0.85,
      sheenColor: new THREE.Color(0xffffff),
      clearcoat: 0.36,
      clearcoatRoughness: 0.55,
    })
    const young = base.clone()
    const mature = base.clone()
    this.variants = [
      { material: young, u: applyLeafShader(young), stressMul: 0.55 },
      { material: base, u: applyLeafShader(base), stressMul: 1 },
      { material: mature, u: applyLeafShader(mature), stressMul: 1.25 },
    ]
    this.material = base
    this.leafUniforms = this.variants[1]!.u
    if (withDew) this.dew = new DewLayer(this.group)
    parent.add(this.group)
    this.group.add(this.leafGroup)
    this.buildPot()
  }

  private readonly material: THREE.MeshPhysicalMaterial
  private readonly leafUniforms: LeafMaterialUniforms

  /** 释放本实例的全部 GPU 资源（联系表等批量场景使用） */
  dispose(): void {
    this.group.removeFromParent()
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (mesh.isMesh) mesh.geometry.dispose()
    })
    for (const v of this.variants) v.material.dispose()
    this.dew?.dispose()
    this.leafGeometry?.dispose()
  }

  updateDew(timeMs: number): void {
    this.dew?.update(timeMs, this.meshes)
  }

  /** 花盆（lathe 轮廓）+ 土面 + 矮桩（04 §4.3） */
  private buildPot(): void {
    const terracotta = new THREE.MeshStandardMaterial({ color: 0xb5654a, roughness: 0.9 })
    const profile = [
      new THREE.Vector2(0.1, -46),
      new THREE.Vector2(14.4, -44),
      new THREE.Vector2(19.4, -36),
      new THREE.Vector2(22.3, -14),
      new THREE.Vector2(23.4, 0),
      new THREE.Vector2(24.8, 3),
      new THREE.Vector2(23.8, 5),
      new THREE.Vector2(21.6, 3),
      new THREE.Vector2(20.5, -2),
    ]
    const pot = new THREE.Mesh(new THREE.LatheGeometry(profile, 48), terracotta)
    pot.position.y = SOIL_Y
    pot.receiveShadow = true
    this.group.add(pot)

    const soil = new THREE.Mesh(
      new THREE.CylinderGeometry(20, 18, 5, 40),
      new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: 1 }),
    )
    soil.position.y = SOIL_Y + 1
    soil.receiveShadow = true
    this.group.add(soil)

    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(3.4, 4.6, 4, 12),
      new THREE.MeshStandardMaterial({ color: 0x6b7d4f, roughness: 0.95 }),
    )
    stem.position.y = SOIL_Y + 3
    stem.receiveShadow = true
    this.group.add(stem)
  }

  update(snapshot: PhenotypeSnapshot): void {
    const { material, shape } = snapshot

    // 粉霜：CPU 侧轻混（M2 反馈：白化克制）
    const fr = material.farina * 0.15
    const mixTo = (a: number, b: number): number => a + (b - a) * fr
    const palette: [number, number, number][] = [
      material.youngColor,
      material.baseColor,
      material.matureColor,
    ]
    const targets: [number, number, number][] = [
      [0.9, 0.93, 0.87],
      [0.88, 0.92, 0.86],
      [0.86, 0.9, 0.85],
    ]
    this.variants.forEach((v, i) => {
      const c = palette[i]!
      const tgt = targets[i]!
      v.material.color.setRGB(mixTo(c[0]!, tgt[0]), mixTo(c[1]!, tgt[1]), mixTo(c[2]!, tgt[2]))
      v.material.roughness = Math.min(
        1,
        0.62 - 0.25 * material.gloss + (1 - snapshot.water) * 0.12 + i * 0.04,
      )
      v.material.sheen = 0.08 + 0.15 * material.farina
      v.material.clearcoat = 0.2 + 0.4 * material.gloss
      v.material.clearcoatRoughness = 0.5 + 0.2 * (1 - snapshot.water)
      v.u.uStressColor.value.setRGB(
        material.stressColor[0]!,
        material.stressColor[1]!,
        material.stressColor[2]!,
      )
      v.u.uStressAmount.value = Math.min(1, material.stressAmount * v.stressMul)
      v.u.uTranslucency.value = 0.35 + 0.45 * (1 - snapshot.water)
    })

    const key = `${shape.tipSharpness.toFixed(3)}|${shape.openness.toFixed(3)}|${shape.curvature.toFixed(3)}`
    if (this.leafGeometry === undefined || key !== this.geometryKey) {
      this.leafGeometry?.dispose()
      this.leafGeometry = buildLeafGeometry(shape)
      this.geometryKey = key
    }

    if (snapshot.organs.length !== this.lastOrganCount) {
      this.rebuildLeaves(snapshot.organs.length)
    }

    const n = snapshot.organs.length
    const stemTop = SOIL_Y + 5
    for (let i = 0; i < n; i++) {
      const pose = snapshot.organs[i]!
      const mesh = this.meshes[i]!
      mesh.position.set(
        Math.sin(pose.azimuth) * pose.offset,
        stemTop,
        Math.cos(pose.azimuth) * pose.offset,
      )
      mesh.rotation.order = 'YXZ'
      mesh.rotation.set(pose.tilt, pose.azimuth, 0)
      mesh.scale.set(pose.width, pose.length, pose.thickness)
      const fOrg = n > 1 ? (n - 1 - i) / (n - 1) : 0
      mesh.material = this.variants[fOrg < 0.34 ? 0 : fOrg < 0.67 ? 1 : 2]!.material
    }
  }

  private rebuildLeaves(count: number): void {
    for (const mesh of this.meshes) {
      this.leafGroup.remove(mesh)
    }
    this.meshes.length = 0
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(this.leafGeometry!, this.variants[1]!.material)
      mesh.castShadow = true
      mesh.receiveShadow = true
      this.leafGroup.add(mesh)
      this.meshes.push(mesh)
    }
    this.lastOrganCount = count
  }
}
