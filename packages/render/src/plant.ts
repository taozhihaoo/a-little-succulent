/**
 * PlantRenderer（07 §4）：消费 PhenotypeSnapshot 更新莲座、茎、盆。
 * 规则：只读快照，永不反推植物状态；器官数量变化时重建，否则只更新变换。
 *
 * 结构：
 *  - pot.ts      花盆 / 土面 / 铺面石 / 茎 / 接触阴影
 *  - leaf.ts     单叶封闭实体几何（共享一份，按形状键重建）
 *  - leaf-material 叶片 shader（伪 SSS / 应激色 / 锦化 / 闪粉）
 * 本文件只负责"把姿态贴到网格上"以及花剑、浇水、露珠等短时特效。
 */
import * as THREE from 'three'
import type { PhenotypeSnapshot } from '@succulent/sim'
import { buildLeafGeometry } from './leaf'
import { applyLeafShader, type LeafMaterialUniforms } from './leaf-material'
import { DewLayer } from './dew'
import { createPot, SOIL_TOP_Y, type PotHandles } from './pot'

interface LeafVariant {
  material: THREE.MeshPhysicalMaterial
  u: LeafMaterialUniforms
  stressMul: number
}

interface SpikeRig {
  group: THREE.Group
  stalkMaterial: THREE.MeshStandardMaterial
  budMaterial: THREE.MeshStandardMaterial
  buds: THREE.Mesh[]
}

/** 整数 → [0,1) 的稳定哈希（叶片扭角/尺寸抖动用，不要 Math.random：重载后应一致） */
function hash01(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

export class PlantRenderer {
  readonly group = new THREE.Group()
  readonly dew: DewLayer | undefined
  private readonly leafGroup = new THREE.Group()
  private readonly variants: LeafVariant[]
  private readonly meshes: THREE.Mesh[] = []
  private readonly pot: PotHandles
  private leafGeometry: THREE.BufferGeometry | undefined
  private geometryKey = ''
  private lastOrganCount = -1
  private spike: SpikeRig | undefined
  private waterGeometry: THREE.SphereGeometry | undefined
  private waterMaterial: THREE.MeshPhysicalMaterial | undefined
  private readonly waterDrops: { mesh: THREE.Mesh; born: number; y0: number; x: number; z: number }[] = []
  private readonly sched: { requestFrames(durationMs: number): void } | undefined

  constructor(
    parent: THREE.Object3D,
    withDew = true,
    sched?: { requestFrames(durationMs: number): void },
    /** 植株 id：决定盆型与铺面石分布（同一株重载后外观一致） */
    id = 'plant',
  ) {
    this.sched = sched
    const base = new THREE.MeshPhysicalMaterial({
      color: 0x7da87b,
      roughness: 0.62,
      sheen: 0.08,
      sheenRoughness: 0.85,
      sheenColor: new THREE.Color(0xffffff),
      clearcoat: 0.36,
      clearcoatRoughness: 0.55,
    })
    // 嫩 / 基 / 深三档叶色：内圈浅、外圈深（04 §7 的辐射分布）
    this.variants = [0.55, 1, 1.25].map((stressMul, i) => {
      const material = i === 1 ? base : base.clone()
      return { material, u: applyLeafShader(material), stressMul }
    })

    this.pot = createPot(id, typeof document !== 'undefined')
    this.group.add(this.pot.group)

    if (withDew) {
      this.dew = new DewLayer(this.group, sched ? (d) => sched.requestFrames(d) : undefined)
    }
    parent.add(this.group)
    this.group.add(this.leafGroup)
  }

  /** 释放本实例的全部 GPU 资源（联系表等批量场景使用） */
  dispose(): void {
    this.group.removeFromParent()
    this.dew?.dispose()
    for (const v of this.variants) v.material.dispose()
    this.leafGeometry?.dispose()
    this.waterGeometry?.dispose()
    this.waterMaterial?.dispose()
    this.disposeSpike()
    this.pot.dispose()
  }

  /** 浇水视觉：数颗水滴从上方落下（约 0.6s） */
  waterBurst(nowMs: number): void {
    if (this.waterDrops.length > 0) return
    if (!this.waterGeometry) {
      this.waterGeometry = new THREE.SphereGeometry(0.95, 10, 8)
      this.waterMaterial = new THREE.MeshPhysicalMaterial({
        color: 0xa8d8f0,
        roughness: 0.05,
        transparent: true,
        opacity: 0.5,
        clearcoat: 1,
      })
    }
    const y0 = SOIL_TOP_Y + 42
    for (let i = 0; i < 5; i++) {
      const mesh = new THREE.Mesh(this.waterGeometry, this.waterMaterial)
      const x = (Math.random() - 0.5) * 22
      const z = (Math.random() - 0.5) * 22
      mesh.position.set(x, y0, z)
      mesh.scale.set(1, 1.35, 1)
      this.group.add(mesh)
      this.waterDrops.push({ mesh, born: nowMs + i * 90, y0, x, z })
    }
    // 水滴落完前必须有帧：Ambient 态平时是停帧的
    this.sched?.requestFrames(1800)
  }

  updateEffects(timeMs: number): void {
    this.dew?.update(timeMs, this.meshes)
    const ground = SOIL_TOP_Y + 1.5
    for (let i = this.waterDrops.length - 1; i >= 0; i--) {
      const d = this.waterDrops[i]
      if (!d) continue
      const age = timeMs - d.born
      if (age < 0) continue
      const t = Math.min(1, age / 560)
      d.mesh.position.set(d.x, d.y0 + (ground - d.y0) * t * t, d.z)
      if (t >= 1) {
        this.group.remove(d.mesh)
        this.waterDrops.splice(i, 1)
      }
    }
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
      // 色板值是"作者视角的 sRGB"，必须按 sRGB 解释——否则会被当成线性值直接过亮（全株发白）
      v.material.color.setRGB(
        mixTo(c[0]!, tgt[0]),
        mixTo(c[1]!, tgt[1]),
        mixTo(c[2]!, tgt[2]),
        THREE.SRGBColorSpace,
      )
      v.material.roughness = Math.min(
        1,
        0.62 - 0.25 * material.gloss + (1 - snapshot.water) * 0.12 + i * 0.04,
      )
      v.material.sheen = 0.05 + 0.12 * material.farina
      v.material.clearcoat = 0.2 + 0.4 * material.gloss
      v.material.clearcoatRoughness = 0.5 + 0.2 * (1 - snapshot.water)
      v.u.uStressColor.value.setRGB(
        material.stressColor[0]!,
        material.stressColor[1]!,
        material.stressColor[2]!,
        THREE.SRGBColorSpace,
      )
      v.u.uStressAmount.value = Math.min(1, material.stressAmount * v.stressMul)
      v.u.uSparkle.value = 0.4 + 0.6 * material.farina
      v.u.uTranslucency.value = 0.35 + 0.45 * (1 - snapshot.water)
      v.u.uVariegata.value = material.variegata
    })

    this.updateSpike(snapshot)

    // 土面湿度：湿则深、干则浅（04 §6）；铺面石同步压暗
    const damp = 1 - 0.35 * snapshot.water
    this.pot.soilMaterial.color.setRGB(0.24 * damp, 0.185 * damp, 0.14 * damp, THREE.SRGBColorSpace)
    this.pot.granuleMaterial.color.setScalar(1 - 0.4 * snapshot.water)

    const key = `${shape.tipSharpness.toFixed(3)}|${shape.openness.toFixed(3)}|${shape.curvature.toFixed(3)}`
    if (this.leafGeometry === undefined || key !== this.geometryKey) {
      this.leafGeometry?.dispose()
      this.leafGeometry = buildLeafGeometry(shape)
      this.geometryKey = key
      // 形状变了必须让已有叶片换几何：旧几何已 dispose，继续引用会画不出来
      for (const mesh of this.meshes) mesh.geometry = this.leafGeometry
    }

    const n = snapshot.organs.length
    if (n !== this.lastOrganCount) this.rebuildLeaves(n)
    // 茎：顶端 = 莲座基座；老桩把莲座整体抬高
    const stemTop = SOIL_TOP_Y + 1.6 + snapshot.stem.heightMm * 0.55
    const stemBase = SOIL_TOP_Y - 2
    const stemH = Math.max(2, stemTop - stemBase + 1.2)
    this.pot.stem.scale.y = stemH
    this.pot.stem.position.y = stemBase + stemH / 2
    const lig = snapshot.stem.lignification
    this.pot.stemMaterial.color.setRGB(
      0.4 + 0.08 * lig,
      0.48 - 0.2 * lig,
      0.29 - 0.12 * lig,
      THREE.SRGBColorSpace,
    )

    for (let i = 0; i < n; i++) {
      const pose = snapshot.organs[i]!
      const mesh = this.meshes[i]!
      const fOrg = n > 1 ? (n - 1 - i) / (n - 1) : 0
      // 内圈新叶略高：中心不是一块平板
      const lift = (1 - fOrg) * 1.4
      const h = hash01(i * 7 + 1)
      mesh.position.set(
        Math.sin(pose.azimuth) * pose.offset,
        stemTop + lift,
        Math.cos(pose.azimuth) * pose.offset,
      )
      mesh.rotation.order = 'YXZ'
      // z 分量是叶片自身长轴的"翻卷"，让每片叶子的朝向不完全平面化
      mesh.rotation.set(pose.tilt, pose.azimuth, (h - 0.5) * 0.26)
      mesh.scale.set(pose.width, pose.length, pose.thickness)
      mesh.material = this.variants[fOrg < 0.34 ? 0 : fOrg < 0.67 ? 1 : 2]!.material
    }
  }

  private rebuildLeaves(count: number): void {
    for (const mesh of this.meshes) this.leafGroup.remove(mesh)
    this.meshes.length = 0
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(this.leafGeometry!, this.variants[1]!.material)
      mesh.castShadow = true
      // 叶片不接收阴影：厚度只有 1mm 级的薄体自投影只会带来一脸阴影 acne
      // （盆/土仍接收叶片投影，体积感来自那里）
      mesh.receiveShadow = false
      this.leafGroup.add(mesh)
      this.meshes.push(mesh)
    }
    this.lastOrganCount = count
  }

  /** 花剑（M4-8 / M5-1）：细长弯拱 + 顶端贴生花苞串；花苞随 spikeBloom 绽放、随凋谢转褐 */
  private updateSpike(snapshot: PhenotypeSnapshot): void {
    if (!snapshot.spike) {
      this.disposeSpike()
      return
    }
    if (!this.spike) this.buildSpike()

    const rig = this.spike!
    const bloom = snapshot.spikeBloom
    const withered = snapshot.spikeWithered
    rig.budMaterial.color.setRGB(
      0.91 - 0.42 * (withered ? 1 : bloom * 0.35),
      0.6 - 0.3 * (withered ? 1 : bloom * 0.35),
      0.68 - 0.3 * (withered ? 1 : bloom * 0.35),
    )
    if (withered) rig.stalkMaterial.color.setRGB(0.44, 0.4, 0.27)
    else rig.stalkMaterial.color.setRGB(0.32, 0.45, 0.24)
    for (let b = 0; b < rig.buds.length; b++) {
      const bud = rig.buds[b]!
      const order = b / Math.max(1, rig.buds.length - 1)
      // 自下而上依次开放：末端（最靠近拱顶）先开
      const local = Math.max(0, Math.min(1, (bloom - order * 0.45) / 0.55))
      const open = withered ? 1 - 0.35 * bloom : local
      const s = 0.55 + 0.45 * open
      bud.scale.set(s * (1 + 0.35 * open), s * (1.35 - 0.25 * open), s)
      bud.visible = !withered || open > 0.01
    }
  }

  private buildSpike(): void {
    const group = new THREE.Group()
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, SOIL_TOP_Y + 6, 0),
      new THREE.Vector3(1.2, SOIL_TOP_Y + 22, 0.6),
      new THREE.Vector3(5.4, SOIL_TOP_Y + 34, 1.2),
    ])
    const stalkMaterial = new THREE.MeshStandardMaterial({ color: 0x52692e, roughness: 0.8 })
    const stalk = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.45, 8, false), stalkMaterial)
    stalk.castShadow = true
    group.add(stalk)

    const budMaterial = new THREE.MeshStandardMaterial({ color: 0xe89aae, roughness: 0.45 })
    const budGeometry = new THREE.SphereGeometry(1.25, 12, 10)
    const buds: THREE.Mesh[] = []
    for (let b = 0; b < 6; b++) {
      const t = 0.6 + (b / 5) * 0.4
      const p = curve.getPoint(t)
      const tangent = curve.getTangent(t).normalize()
      const side = new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0, 1, 0)).normalize()
      const bud = new THREE.Mesh(budGeometry, budMaterial)
      bud.position.copy(p).addScaledVector(side, (b % 2 === 0 ? 1 : -1) * 1.5)
      bud.position.y -= 0.6
      bud.castShadow = true
      buds.push(bud)
      group.add(bud)
    }
    this.group.add(group)
    this.spike = { group, stalkMaterial, budMaterial, buds }
  }

  private disposeSpike(): void {
    if (!this.spike) return
    const rig = this.spike
    rig.group.removeFromParent()
    rig.group.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (mesh.isMesh) mesh.geometry.dispose()
    })
    rig.stalkMaterial.dispose()
    rig.budMaterial.dispose()
    this.spike = undefined
  }
}
