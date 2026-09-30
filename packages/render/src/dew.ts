/**
 * 露珠微事件（总方案 §7.1）：出现又蒸发的小水珠。
 * 挂件模式专用；生命周期动画只发生在 Ambient burst / Active 渲染帧里
 * （scheduler 的 onFrame 回调驱动，不持有自己的 RAF）。
 */
import * as THREE from 'three'

interface DewDrop {
  born: number
  life: number
  pos: THREE.Vector3
  scale: number
}

const MAX_DEW = 6

export class DewLayer {
  readonly group = new THREE.Group()
  private readonly mesh: THREE.InstancedMesh
  private readonly drops: DewDrop[] = []
  private nextSpawn = 2000
  private readonly dummy = new THREE.Object3D()

  constructor(parent: THREE.Object3D) {
    this.mesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 10, 10),
      new THREE.MeshPhysicalMaterial({
        color: 0xeaf6ff,
        roughness: 0.03,
        transparent: true,
        opacity: 0.55,
        clearcoat: 1,
        clearcoatRoughness: 0.05,
        depthWrite: false,
      }),
      MAX_DEW,
    )
    this.mesh.count = 0
    this.mesh.renderOrder = 2
    this.group.add(this.mesh)
    parent.add(this.group)
  }

  /** timeMs 来自 scheduler 的渲染帧回调 */
  update(timeMs: number, leaves: THREE.Mesh[]): void {
    if (leaves.length === 0) {
      this.mesh.count = 0
      return
    }
    if (this.drops.length < MAX_DEW && timeMs >= this.nextSpawn) {
      this.nextSpawn = timeMs + 6000 + Math.random() * 9000
      const mesh = leaves[Math.floor(Math.random() * leaves.length)]!
      const local = new THREE.Vector3(
        (Math.random() - 0.5) * 1.1,
        0.3 + Math.random() * 0.55,
        0.05,
      )
      this.drops.push({
        born: timeMs,
        life: 14000 + Math.random() * 16000,
        pos: mesh.localToWorld(local),
        scale: 0.6 + Math.random() * 0.5,
      })
    }
    let n = 0
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i]!
      const age = timeMs - d.born
      if (age > d.life) {
        this.drops.splice(i, 1)
        continue
      }
      const fadeIn = Math.min(1, age / 400)
      const fadeOut = Math.min(1, (d.life - age) / 600)
      this.dummy.position.copy(d.pos)
      this.dummy.scale.setScalar(Math.max(0.001, d.scale * fadeIn * fadeOut))
      this.dummy.updateMatrix()
      this.mesh.setMatrixAt(n, this.dummy.matrix)
      n++
    }
    this.mesh.count = n
    this.mesh.instanceMatrix.needsUpdate = true
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    const material = this.mesh.material as THREE.Material
    material.dispose()
    this.group.removeFromParent()
  }
}
