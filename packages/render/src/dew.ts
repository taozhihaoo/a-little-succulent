/**
 * 露珠微事件（总方案 §7.1）：出现又蒸发的小水珠。
 * 淡入/蒸发窗口期间通过 requestFrames 向调度器要帧——不再瞬现瞬失。
 */
import * as THREE from 'three'

interface DewDrop {
  born: number
  life: number
  /** 附着的叶片下标：每帧按叶片当前矩阵重投影（叶片随生长移动，否则水珠会"飘在空中"） */
  leaf: number
  /** 叶片局部坐标（单位叶空间） */
  local: THREE.Vector3
  scale: number
  fading: boolean
}

const MAX_DEW = 6
const FADE_IN_MS = 700
const FADE_OUT_MS = 1500

export class DewLayer {
  readonly group = new THREE.Group()
  private readonly mesh: THREE.InstancedMesh
  private readonly drops: DewDrop[] = []
  private nextSpawn = 2000
  private readonly dummy = new THREE.Object3D()
  private readonly requestFrames: ((durationMs: number) => void) | undefined

  constructor(parent: THREE.Object3D, requestFrames?: (durationMs: number) => void) {
    this.requestFrames = requestFrames
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
      this.nextSpawn = timeMs + 9000 + Math.random() * 12000
      const leafIndex = Math.floor(Math.random() * leaves.length)
      // 叶面（局部 -Z 一侧）偏叶缘的位置：真实露珠挂在叶缘/叶面凹处
      const local = new THREE.Vector3((Math.random() - 0.5) * 0.7, 0.35 + Math.random() * 0.45, -0.08)
      this.drops.push({
        born: timeMs,
        life: 20000 + Math.random() * 18000,
        leaf: leafIndex,
        local,
        scale: 0.55 + Math.random() * 0.45,
        fading: false,
      })
      this.requestFrames?.(FADE_IN_MS + 400)
    }
    let n = 0
    const world = new THREE.Vector3()
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i]!
      const age = timeMs - d.born
      const host = leaves[d.leaf]
      if (age > d.life || !host) {
        this.drops.splice(i, 1)
        continue
      }
      if (!d.fading && age > d.life - FADE_OUT_MS) {
        d.fading = true
        this.requestFrames?.(FADE_OUT_MS + 400)
      }
      const tIn = Math.min(1, age / FADE_IN_MS)
      const tOut = Math.min(1, (d.life - age) / FADE_OUT_MS)
      const eased = tIn * tIn * (3 - 2 * tIn)
      world.copy(d.local).applyMatrix4(host.matrixWorld)
      this.group.worldToLocal(world)
      this.dummy.position.copy(world)
      this.dummy.scale.setScalar(Math.max(0.001, d.scale * eased * tOut))
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
