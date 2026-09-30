/**
 * 参数化叶片几何（04 §4.1）：纯函数，参数 → 顶点数据，可脱离场景批量出图（03 §7）。
 * 单位叶：长度 1（沿 +Y），宽度/厚度为相对量；横截面超椭圆扁匙形，
 * 纵向中肋弯月弯曲；顶点属性 aT（基→尖）/ aC（中肋→缘）供 M2 shader 使用。
 */
import * as THREE from 'three'

const LENGTH_SEGMENTS = 12
const WIDTH_SEGMENTS = 8

export interface LeafShapeParams {
  /** 0~1 叶尖聚拢感 */
  tipSharpness: number
  /** 0~1 横截面开合（浅匙 → 深凹） */
  openness: number
  /** 0~1 纵向弯月弯曲 */
  curvature: number
}

export function buildLeafGeometry(params: LeafShapeParams): THREE.BufferGeometry {
  const { tipSharpness, openness, curvature } = params
  const positions: number[] = []
  const aT: number[] = []
  const aC: number[] = []
  const indices: number[] = []

  for (let j = 0; j <= LENGTH_SEGMENTS; j++) {
    const v = j / LENGTH_SEGMENTS
    // 宽度轮廓：基部收窄 → 前 1/3 处最宽 → 收尖
    // 钳制到 >= 0：v=1 时 0.12+0.88v 会浮点超出 1，sin 为负，负数幂 = NaN（整叶被剔除）
    const s = Math.max(0, Math.sin(Math.PI * (0.12 + 0.88 * v)))
    const taper = Math.pow(s, 0.55 + 0.75 * (1 - tipSharpness))
    const bend = curvature * 0.35 * v * v
    for (let i = 0; i <= WIDTH_SEGMENTS; i++) {
      const u = (i / WIDTH_SEGMENTS) * 2 - 1
      const x = u * 0.5 * taper
      const lens = Math.sqrt(Math.max(0, 1 - u * u))
      const thickness = taper * (0.65 + 0.35 * (1 - v)) * (0.7 + 0.3 * openness)
      const z = lens * thickness * 0.5 + bend
      positions.push(x, v, z)
      aT.push(v)
      aC.push((u + 1) / 2)
    }
  }

  const row = WIDTH_SEGMENTS + 1
  for (let j = 0; j < LENGTH_SEGMENTS; j++) {
    for (let i = 0; i < WIDTH_SEGMENTS; i++) {
      const a = j * row + i
      const b = a + 1
      const c = a + row
      const d = c + 1
      indices.push(a, c, b, b, c, d)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setIndex(indices)
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('aT', new THREE.Float32BufferAttribute(aT, 1))
  geometry.setAttribute('aC', new THREE.Float32BufferAttribute(aC, 1))
  geometry.computeVertexNormals()
  return geometry
}
