/**
 * 花盆 / 土面 / 茎（04 §4.3）：程序化 lathe + 实例化铺面石。
 *
 * 设计要点：
 *  - 盆体是**有壁厚的旋转体**：外壁 → 圆润口沿 → 内壁 → 盆底，所以从斜上方能看到
 *    口沿的厚度和盆内的暗部（旧实现口沿是一圈回折的零厚度曲面，看起来像塑料片）。
 *  - 顶点色烘一层廉价 AO（盆底/盆内/口沿内侧压暗），只为体积感，不依赖外部贴图。
 *  - 两种盆型（红陶 / 哑光水泥灰），按植株 id 稳定选取——群生时不会一盆到底全同款。
 *  - 土面是微凸圆盘 + 颗粒铺面（赤玉/麦饭石/火山岩/珍珠岩），颗粒按植株 id 稳定散布。
 *  - 盆下有一张柔和接触阴影（像素级 alpha 贴图），让挂件"落"在桌面上而不是飘着。
 */
import * as THREE from 'three'

/** 土面中心高度（植株基座所在的平面） */
export const SOIL_TOP_Y = 4

export type PotStyle = 'terracotta' | 'concrete'

interface ProfilePoint {
  r: number
  y: number
  /** 顶点色（乘以基色）：廉价 AO */
  ao: number
}

interface PotPalette {
  body: number
  soil: number
  /** 铺面石配色（真实配土：赤玉土 / 麦饭石 / 火山岩 / 珍珠岩） */
  grit: number[]
}

const PALETTES: Record<PotStyle, PotPalette> = {
  terracotta: {
    body: 0xa86b50,
    soil: 0x3d2f24,
    grit: [0x8d7561, 0x9b9184, 0x4a4038, 0xd9d2c3, 0xa8613f],
  },
  concrete: {
    body: 0x9c9a94,
    soil: 0x3a332c,
    grit: [0x8a8177, 0x9a9488, 0x494440, 0xdedad0, 0x7d6f60],
  },
}

/** 盆体母线：外壁自下而上 → 口沿外翻 → 内壁 → 盆腔底（y 为世界高度） */
const BODY_PROFILE: ProfilePoint[] = [
  { r: 0, y: -20, ao: 0.56 },
  { r: 10.0, y: -20, ao: 0.6 },
  { r: 13.8, y: -19.6, ao: 0.66 },
  { r: 14.7, y: -18.1, ao: 0.73 },
  { r: 15.2, y: -15.4, ao: 0.8 },
  { r: 15.8, y: -11.6, ao: 0.87 },
  { r: 16.5, y: -6.6, ao: 0.92 },
  { r: 17.2, y: -2.1, ao: 0.96 },
  { r: 17.8, y: 2.2, ao: 1 },
  { r: 18.6, y: 6.0, ao: 1 },
  { r: 19.1, y: 7.8, ao: 0.98 },
  { r: 18.4, y: 8.8, ao: 0.92 },
  { r: 17.4, y: 8.3, ao: 0.76 },
  { r: 17.1, y: 5.0, ao: 0.62 },
  { r: 16.9, y: 0.8, ao: 0.52 },
  { r: 16.5, y: -2.5, ao: 0.42 },
  { r: 15.3, y: -4.3, ao: 0.34 },
  { r: 9.2, y: -4.9, ao: 0.28 },
  { r: 0, y: -5, ao: 0.26 },
]

/** 土面母线：微凸圆盘（中心最高），边缘塞进盆内壁 */
const SOIL_PROFILE: ProfilePoint[] = [
  { r: 0, y: SOIL_TOP_Y + 0.4, ao: 1 },
  { r: 4.6, y: SOIL_TOP_Y + 0.25, ao: 1 },
  { r: 8.3, y: SOIL_TOP_Y - 0.2, ao: 1 },
  { r: 11.6, y: SOIL_TOP_Y - 1.0, ao: 0.97 },
  { r: 14.9, y: SOIL_TOP_Y - 1.9, ao: 0.9 },
  { r: 16.9, y: SOIL_TOP_Y - 2.6, ao: 0.8 },
]

/** 土面在半径 r 处的高度（颗粒铺面必须贴合这个面） */
export function soilSurfaceY(r: number): number {
  const pts = SOIL_PROFILE
  if (r <= pts[0]!.r) return pts[0]!.y
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!
    const b = pts[i]!
    if (r <= b.r) {
      const t = (r - a.r) / (b.r - a.r)
      return a.y + (b.y - a.y) * t
    }
  }
  return pts[pts.length - 1]!.y
}

/** 稳定伪随机（按植株 id 播种）：重载后铺面石/盆型不变 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export interface PotHandles {
  group: THREE.Group
  soilMaterial: THREE.MeshStandardMaterial
  granuleMaterial: THREE.MeshStandardMaterial
  stem: THREE.Mesh
  stemMaterial: THREE.MeshStandardMaterial
  /** 盆体高度方向的跨度（相机取景/接触阴影用） */
  bottomY: number
  dispose(): void
}

/**
 * 建盆。`id` 决定盆型与铺面石分布（同一株重载后外观一致）。
 * `withShadow`：接触阴影贴图需要 document（Node 端测试不建）。
 */
export function createPot(id: string, withShadow: boolean): PotHandles {
  const rnd = mulberry32(hashString(id))
  const style: PotStyle = rnd() < 0.72 ? 'terracotta' : 'concrete'
  const pal = PALETTES[style]
  const group = new THREE.Group()
  const disposables: { dispose(): void }[] = []

  // —— 盆体 ——
  const bodyGeometry = new THREE.LatheGeometry(
    BODY_PROFILE.map((p) => new THREE.Vector2(p.r, p.y)),
    72,
  )
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: pal.body,
    roughness: 0.92,
    metalness: 0,
    vertexColors: true,
    // 陶土表面不是纯漫反射：给一点 sheen 让高光有宽度而不塑料
    envMapIntensity: 0.55,
  })
  applyProfileAO(bodyGeometry, BODY_PROFILE)
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial)
  body.castShadow = true
  body.receiveShadow = true
  group.add(body)
  disposables.push(bodyGeometry, bodyMaterial)

  // —— 土面 ——
  const soilGeometry = new THREE.LatheGeometry(
    SOIL_PROFILE.map((p) => new THREE.Vector2(p.r, p.y)),
    72,
  )
  const soilMaterial = new THREE.MeshStandardMaterial({
    color: pal.soil,
    roughness: 1,
    metalness: 0,
    vertexColors: true,
  })
  applyProfileAO(soilGeometry, SOIL_PROFILE)
  const soil = new THREE.Mesh(soilGeometry, soilMaterial)
  soil.receiveShadow = true
  group.add(soil)
  disposables.push(soilGeometry, soilMaterial)

  // —— 铺面石（实例化：一次 draw call）——
  const GRIT_COUNT = 460
  const gritGeometry = new THREE.IcosahedronGeometry(1, 0)
  const granuleMaterial = new THREE.MeshStandardMaterial({ roughness: 0.86, metalness: 0 })
  const grit = new THREE.InstancedMesh(gritGeometry, granuleMaterial, GRIT_COUNT)
  const dummy = new THREE.Object3D()
  const color = new THREE.Color()
  for (let i = 0; i < GRIT_COUNT; i++) {
    const ang = rnd() * Math.PI * 2
    // sqrt 分布：面积均匀，不会全堆在盆心
    const rad = 1.0 + Math.sqrt(rnd()) * 15.2
    const size = 0.42 + Math.pow(rnd(), 2.2) * 1.15
    dummy.position.set(
      Math.cos(ang) * rad,
      soilSurfaceY(rad) + size * 0.34,
      Math.sin(ang) * rad,
    )
    dummy.rotation.set(rnd() * Math.PI, rnd() * Math.PI * 2, rnd() * Math.PI)
    // 略扁的多面体 = 碎石，而不是滚圆的小球
    dummy.scale.set(size * (0.9 + rnd() * 0.5), size * (0.52 + rnd() * 0.35), size * (0.9 + rnd() * 0.5))
    dummy.updateMatrix()
    grit.setMatrixAt(i, dummy.matrix)
    const hex = pal.grit[Math.floor(rnd() * pal.grit.length)]!
    const shade = 0.82 + rnd() * 0.36
    grit.setColorAt(i, color.setHex(hex).multiplyScalar(shade))
  }
  grit.instanceMatrix.needsUpdate = true
  if (grit.instanceColor) grit.instanceColor.needsUpdate = true
  grit.receiveShadow = true
  grit.castShadow = false
  group.add(grit)
  disposables.push(gritGeometry, granuleMaterial)

  // —— 茎（土面 → 莲座基座；老桩会随 heightMm 拉长变成木质化短桩）——
  const stemGeometry = new THREE.CylinderGeometry(3.5, 5.2, 1, 20, 1, false)
  const stemMaterial = new THREE.MeshStandardMaterial({ color: 0x6f8049, roughness: 0.95 })
  const stem = new THREE.Mesh(stemGeometry, stemMaterial)
  stem.castShadow = true
  stem.receiveShadow = true
  group.add(stem)
  disposables.push(stemGeometry, stemMaterial)

  // —— 接触阴影（透明窗口里唯一的"落影"，让盆不飘）——
  if (withShadow && typeof document !== 'undefined') {
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 256
    const ctx = canvas.getContext('2d')
    if (ctx) {
      const grad = ctx.createRadialGradient(128, 128, 8, 128, 128, 126)
      grad.addColorStop(0, 'rgba(0,0,0,0.5)')
      grad.addColorStop(0.45, 'rgba(0,0,0,0.26)')
      grad.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, 256, 256)
      const texture = new THREE.CanvasTexture(canvas)
      const shadowMaterial = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        opacity: 0.6,
      })
      const shadow = new THREE.Mesh(new THREE.PlaneGeometry(104, 104), shadowMaterial)
      shadow.rotation.x = -Math.PI / 2
      shadow.position.y = -19.7
      shadow.renderOrder = -1
      group.add(shadow)
      disposables.push(texture, shadowMaterial, shadow.geometry)
    }
  }

  return {
    group,
    soilMaterial,
    granuleMaterial,
    stem,
    stemMaterial,
    bottomY: -20,
    dispose() {
      for (const d of disposables) d.dispose()
    },
  }
}

/** 按母线顶点写顶点色（LatheGeometry 顶点顺序 = 环 × 母线点，故对母线点数取模） */
function applyProfileAO(
  geometry: THREE.BufferGeometry,
  profile: ProfilePoint[],
): void {
  const n = profile.length
  const count = geometry.getAttribute('position').count
  const colors = new Float32Array(count * 3)
  for (let v = 0; v < count; v++) {
    const ao = profile[v % n]!.ao
    colors[v * 3] = ao
    colors[v * 3 + 1] = ao
    colors[v * 3 + 2] = ao
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
}
