import { readFileSync, writeFileSync } from 'node:fs'

const p = 'packages/render/src/plant.ts'
let s = readFileSync(p, 'utf8')

// 1) import 新材质
if (!s.includes('createLeafMaterial')) {
  const oldImp = `import { buildLeafGeometry } from './leaf'`
  if (!s.includes(oldImp)) throw new Error('import anchor not found')
  s = s.replace(
    oldImp,
    `import { buildLeafGeometry } from './leaf'\nimport { createLeafMaterial, type LeafMaterialUniforms } from './leaf-material'`,
  )
}

// 2) 构造器换材质 + 保存 uniforms
const oldCtor = `  constructor(parent: THREE.Object3D) {
    this.material = new THREE.MeshPhysicalMaterial({
      color: 0x7da87b,
      roughness: 0.6,
      sheen: 0.5,
      sheenRoughness: 0.9,
      sheenColor: new THREE.Color(0xffffff),
    })
`
const newCtor = `  private readonly leafUniforms: LeafMaterialUniforms

  constructor(parent: THREE.Object3D) {
    const { material, uniforms } = createLeafMaterial()
    this.material = material
    this.leafUniforms = uniforms
`
if (!s.includes(oldCtor)) throw new Error('ctor anchor not found')
s = s.replace(oldCtor, newCtor)

// 3) update() 换参数逻辑：粉霜 CPU 混色 + 应激渐变总量 + 透光随水分
const oldUpdate = `    const { material, shape } = snapshot

    this.material.color.setRGB(material.baseColor[0]!, material.baseColor[1]!, material.baseColor[2]!)
    this.material.roughness = Math.min(1, 0.78 - 0.3 * material.gloss + (1 - snapshot.water) * 0.15)
    this.material.sheen = 0.15 + 0.6 * material.farina
`
const newUpdate = `    const { material, shape } = snapshot

    // 粉霜：CPU 侧基色提亮去饱和（M2 §38.2），剩余交给 sheen
    const f = material.farina * 0.55
    const mix = (a: number, b: number): number => a + (b - a) * f
    this.material.color.setRGB(
      mix(material.baseColor[0]!, 0.92),
      mix(material.baseColor[1]!, 0.94),
      mix(material.baseColor[2]!, 0.9),
    )
    this.material.roughness = Math.min(1, 0.78 - 0.3 * material.gloss + (1 - snapshot.water) * 0.15)
    this.material.sheen = 0.15 + 0.5 * material.farina
    this.material.clearcoat = 0.15 + 0.35 * material.gloss
    this.material.clearcoatRoughness = 0.35 + 0.3 * (1 - snapshot.water)

    this.leafUniforms.uStressColor.value.setRGB(
      material.stressColor[0]!,
      material.stressColor[1]!,
      material.stressColor[2]!,
    )
    this.leafUniforms.uStressAmount.value = material.stressAmount
    // 缺水时叶片变薄 → 透光更强（04 §6：饱满度影响质感）
    this.leafUniforms.uTranslucency.value = 0.35 + 0.45 * (1 - snapshot.water)
`
if (!s.includes(oldUpdate)) throw new Error('update anchor not found')
s = s.replace(oldUpdate, newUpdate)

writeFileSync(p, s)
console.log('plant renderer updated OK')
