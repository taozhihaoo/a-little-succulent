/**
 * PlantRenderer（07 §4）：消费 PhenotypeSnapshot 更新莲座、茎、盆。
 * 规则：只读快照，永不反推植物状态；器官数量变化时重建，否则只更新变换。
 */
import * as THREE from 'three'
import type { PhenotypeSnapshot } from '@succulent/sim'
import { buildLeafGeometry, type LeafShapeParams } from './leaf'

const SOIL_Y = 4

export class PlantRenderer {
  readonly group = new THREE.Group()
  private readonly leafGroup = new THREE.Group()
  private readonly meshes: THREE.Mesh[] = []
  private readonly material: THREE.MeshPhysicalMaterial
  private leafGeometry: THREE.BufferGeometry | undefined
  private geometryKey = ''
  private lastOrganCount = -1

  constructor(scene: THREE.Scene) {
    this.material = new THREE.MeshPhysicalMaterial({
      color: 0x7da87b,
      roughness: 0.6,
      sheen: 0.4,
      sheenRoughness: 0.9,
      sheenColor: new THREE.Color(0xffffff),
    })

    scene.add(this.group)
    this.group.add(this.leafGroup)
    this.buildPot()
  }

  /** 花盆（lathe 轮廓）+ 土面 + 短茎桩（04 §4.3）；正式盆型后续扩充 */
  private buildPot(): void {
    const terracotta = new THREE.MeshStandardMaterial({ color: 0xb5654a, roughness: 0.9 })
    const profile = [
      new THREE.Vector2(0.1, -46),
      new THREE.Vector2(20, -44),
      new THREE.Vector2(27, -36),
      new THREE.Vector2(31, -14),
      new THREE.Vector2(32.5, 0),
      new THREE.Vector2(34.5, 3),
      new THREE.Vector2(33, 5),
      new THREE.Vector2(30, 3),
      new THREE.Vector2(28.5, -2),
    ]
    const pot = new THREE.Mesh(new THREE.LatheGeometry(profile, 48), terracotta)
    pot.position.y = SOIL_Y
    this.group.add(pot)

    const soil = new THREE.Mesh(
      new THREE.CylinderGeometry(28.5, 26, 5, 40),
      new THREE.MeshStandardMaterial({ color: 0x3d2f24, roughness: 1 }),
    )
    soil.position.y = SOIL_Y + 1
    this.group.add(soil)

    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(2.6, 3.4, 9, 12),
      new THREE.MeshStandardMaterial({ color: 0x6b7d4f, roughness: 0.95 }),
    )
    stem.position.y = SOIL_Y + 5
    this.group.add(stem)
  }

  update(snapshot: PhenotypeSnapshot): void {
    const { material, shape } = snapshot

    this.material.color.setRGB(material.baseColor[0]!, material.baseColor[1]!, material.baseColor[2]!)
    this.material.roughness = Math.min(1, 0.78 - 0.3 * material.gloss + (1 - snapshot.water) * 0.15)
    this.material.sheen = 0.15 + 0.6 * material.farina

    const key = `${shape.tipSharpness.toFixed(3)}|${shape.openness.toFixed(3)}`
    if (this.leafGeometry === undefined || key !== this.geometryKey) {
      this.leafGeometry?.dispose()
      this.leafGeometry = buildLeafGeometry(shape as LeafShapeParams)
      this.geometryKey = key
    }

    if (snapshot.organs.length !== this.lastOrganCount) {
      this.rebuildLeaves(snapshot.organs.length)
    }

    const stemTop = SOIL_Y + 9
    for (let i = 0; i < snapshot.organs.length; i++) {
      const pose = snapshot.organs[i]!
      const mesh = this.meshes[i]!
      mesh.position.set(
        Math.sin(pose.azimuth) * pose.offset,
        stemTop,
        Math.cos(pose.azimuth) * pose.offset,
      )
      mesh.rotation.order = 'YXZ' // 先方位角（Y）后倾角（X）
      mesh.rotation.set(pose.tilt, pose.azimuth, 0)
      mesh.scale.set(pose.width, pose.length, pose.thickness)
    }
  }

  private rebuildLeaves(count: number): void {
    for (const mesh of this.meshes) {
      this.leafGroup.remove(mesh)
    }
    this.meshes.length = 0
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(this.leafGeometry!, this.material)
      this.leafGroup.add(mesh)
      this.meshes.push(mesh)
    }
    this.lastOrganCount = count
  }
}
