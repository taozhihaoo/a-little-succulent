/**
 * 参数化叶片几何（04 §4.1 / docs/08 §4）：纯函数，参数 → 顶点数据，可脱离场景批量出图（03 §7）。
 *
 * 单位叶：长度 1（沿 +Y），宽度/厚度为相对量。**封闭实体**——上表面（叶面）+ 下表面
 * （叶背，中脉隆起）+ 圆润叶缘一体成环，两端用扇形封口；因此从任何角度看都有实体厚度，
 * 不会出现"薄片背面被剔除 → 叶子凭空消失"的破相（旧实现只有单层曲面）。
 *
 * 顶点属性供 M2 shader 使用：
 *  aT 基(0)→尖(1)   aC 中脉(0)→叶缘(1)   aU 叶面(0)→叶背(1)
 */
import * as THREE from 'three'

const LENGTH_SEGMENTS = 30
const RING_SEGMENTS = 40

export interface LeafShapeParams {
  /** 0~1 叶尖聚拢感 */
  tipSharpness: number
  /** 0~1 叶缘上翘（浅匙 → 深匙） */
  openness: number
  /** 0~1 纵向弯月弯曲（叶尖向下勾） */
  curvature: number
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

/**
 * 半宽轮廓：基部窄（叶柄）→ 中段最宽 → 圆头收尖。
 * 关键在"圆头"：末段用椭圆弧收口，叶尖是一段圆弧而不是一个尖点——
 * 尖点会让整片叶子读成"花瓣/菜叶"，而拟石莲的叶尖是厚钝的（docs/08 §1.1）。
 */
function halfWidthAt(v: number, tipSharpness: number): number {
  const base = 0.34 + 0.66 * smoothstep(0, 0.2, v)
  const waist = 1 - 0.07 * smoothstep(0.25, 0.62, v)
  const capStart = 0.8 - 0.14 * tipSharpness
  let tip = 1
  if (v > capStart) {
    const k = clamp01((v - capStart) / (1 - capStart))
    tip = Math.pow(Math.max(0, 1 - k * k), 0.5 - 0.12 * tipSharpness)
    // 尖头基因：只有高 tipSharpness 才在最后收成尖
    tip *= 1 - 0.5 * tipSharpness * smoothstep(0.86, 1, v)
  }
  return 0.5 * base * waist * tip + 0.008
}

/** 半厚轮廓：基部薄（有叶柄感）→ 中段最厚 → 叶尖略薄但不归零（圆头要有厚度） */
function halfThicknessAt(v: number): number {
  const belly = 0.66 + 0.34 * Math.sin(Math.PI * Math.min(1, 0.22 + v * 0.82))
  const baseThin = 0.52 + 0.48 * smoothstep(0, 0.18, v)
  const tipThin = 1 - 0.4 * smoothstep(0.62, 1, v)
  return 0.26 * belly * baseThin * tipThin + 0.006
}

/** 中肋纵向弯曲：指向叶背（+Z），叶尖下垂成弓（越外侧越弯） */
function bendAt(v: number, curvature: number): number {
  return curvature * 0.42 * v * v
}

export function buildLeafGeometry(params: LeafShapeParams): THREE.BufferGeometry {
  const { tipSharpness, openness, curvature } = params
  const positions: number[] = []
  const aT: number[] = []
  const aC: number[] = []
  const aU: number[] = []
  const indices: number[] = []

  const curl = 0.05 + 0.18 * clamp01(openness)

  for (let j = 0; j <= LENGTH_SEGMENTS; j++) {
    // 采样向叶尖加密：圆头收口处若只有一两圈剖面，会读成"刀切平头"
    const v = 1 - Math.pow(1 - j / LENGTH_SEGMENTS, 1.35)
    const halfW = halfWidthAt(v, tipSharpness)
    const halfT = halfThicknessAt(v)
    const bend = bendAt(v, curvature)
    for (let i = 0; i < RING_SEGMENTS; i++) {
      const theta = (i / RING_SEGMENTS) * Math.PI * 2
      // 椭圆截面：均匀参数化（花式超椭圆会在叶缘挤出细长三角，出现锯齿状"虚线"）
      const cx = Math.cos(theta)
      const cy = Math.sin(theta)
      // 叶背比叶面厚：厚度大半长在背面（拟石莲截面不是对称透镜）
      const tScale = 0.84 + 0.22 * smoothstep(-0.5, 0.5, cy)
      // 中脉：叶背中央沿长度的龙骨隆起
      const keel = cy > 0 ? cy * halfT * 0.42 * Math.exp(-(cx * cx) / 0.2) : 0
      // 叶缘上翘（openness）：两侧向叶面侧抬起，形成浅匙（幅度要小，过大会折成 V 形纸片）
      const lift = curl * cx * cx * halfT
      // 叶面正中一道浅沟（中脉的凹陷侧），让正面有明暗而不是一块平板
      const groove = cy < 0 ? cy * halfT * 0.1 * Math.exp(-(cx * cx) / 0.26) : 0
      const x = cx * halfW
      const z = cy * halfT * tScale + keel - lift + groove + bend
      positions.push(x, v, z)
      aT.push(v)
      aC.push(Math.abs(cx))
      aU.push(cy > 0 ? cy : 0)
    }
  }

  const ring = RING_SEGMENTS
  for (let j = 0; j < LENGTH_SEGMENTS; j++) {
    for (let i = 0; i < RING_SEGMENTS; i++) {
      const i2 = (i + 1) % ring
      const a = j * ring + i
      const b = j * ring + i2
      const c = (j + 1) * ring + i
      const d = (j + 1) * ring + i2
      indices.push(a, c, b, b, c, d)
    }
  }

  // 两端扇形封口（基座藏在莲座心里，叶尖是最小截面）
  const addCap = (row: number, v: number, centerZ: number, flip: boolean): void => {
    const center = positions.length / 3
    positions.push(0, v, centerZ)
    aT.push(v)
    aC.push(0)
    aU.push(0.5)
    for (let i = 0; i < ring; i++) {
      const i2 = (i + 1) % ring
      const a = row * ring + i
      const b = row * ring + i2
      if (flip) indices.push(center, b, a)
      else indices.push(center, a, b)
    }
  }
  addCap(0, 0, bendAt(0, curvature), true)
  addCap(LENGTH_SEGMENTS, 1, bendAt(1, curvature), false)

  const geometry = new THREE.BufferGeometry()
  geometry.setIndex(indices)
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('aT', new THREE.Float32BufferAttribute(aT, 1))
  geometry.setAttribute('aC', new THREE.Float32BufferAttribute(aC, 1))
  geometry.setAttribute('aU', new THREE.Float32BufferAttribute(aU, 1))

  // 绕序自校正：闭合网格的有符号体积为负说明法线朝内，翻转索引顺序即可
  if (signedVolume(positions, indices) < 0) {
    for (let i = 0; i < indices.length; i += 3) {
      const t = indices[i + 1]!
      indices[i + 1] = indices[i + 2]!
      indices[i + 2] = t
    }
    geometry.setIndex(indices)
  }

  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}

/** Σ dot(v0, cross(v1, v2)) / 6：闭合网格的近似体积（用于绕序校正） */
function signedVolume(positions: number[], indices: number[]): number {
  let volume = 0
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i]! * 3
    const b = indices[i + 1]! * 3
    const c = indices[i + 2]! * 3
    const ax = positions[a]!, ay = positions[a + 1]!, az = positions[a + 2]!
    const bx = positions[b]!, by = positions[b + 1]!, bz = positions[b + 2]!
    const cx = positions[c]!, cy = positions[c + 1]!, cz = positions[c + 2]!
    volume += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)
  }
  return volume / 6
}
