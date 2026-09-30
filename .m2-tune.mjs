import { readFileSync, writeFileSync } from 'node:fs'

// —— 1. echeveria.ts：叶基收拢 + 叶厚增加 ——
let e = readFileSync('packages/sim/src/species/echeveria.ts', 'utf8')
const a1 = 'offset: radius * sizeScale,'
if (!e.includes(a1)) throw new Error('anchor1')
e = e.replace(a1, 'offset: radius * sizeScale * 0.4 // 叶基收拢到生长点附近（消除悬浮空隙）')
const a2 = 'thickness: width * (0.25 + 0.4 * tGene),'
if (!e.includes(a2)) throw new Error('anchor2')
e = e.replace(a2, 'thickness: width * (0.38 + 0.6 * tGene), // M2 反馈：加厚去塑料感')
writeFileSync('packages/sim/src/species/echeveria.ts', e)

// —— 2. phenotype：浓绿基色 ——
let p = readFileSync('packages/sim/src/phenotype/index.ts', 'utf8')
const a3 = 'baseColor: hslToRgb(0.28 + 0.17 * g(\'baseHue\'), 0.32, 0.52),'
if (!p.includes(a3)) throw new Error('anchor3')
p = p.replace(a3, "baseColor: hslToRgb(0.28 + 0.17 * g('baseHue'), 0.48, 0.42),")
writeFileSync('packages/sim/src/phenotype/index.ts', p)

// —— 3. plant.ts：盆缩小 / 矮桩 / 阴影 / 粉霜减半 ——
let t = readFileSync('packages/render/src/plant.ts', 'utf8')
const potOld = `  const profile = [
      new THREE.Vector2(0.1, -46),
      new THREE.Vector2(20, -44),
      new THREE.Vector2(27, -36),
      new THREE.Vector2(31, -14),
      new THREE.Vector2(32.5, 0),
      new THREE.Vector2(34.5, 3),
      new THREE.Vector2(33, 5),
      new THREE.Vector2(30, 3),
      new THREE.Vector2(28.5, -2),
    ]`
const potNew = `  const profile = [
      new THREE.Vector2(0.1, -46),
      new THREE.Vector2(14.4, -44),
      new THREE.Vector2(19.4, -36),
      new THREE.Vector2(22.3, -14),
      new THREE.Vector2(23.4, 0),
      new THREE.Vector2(24.8, 3),
      new THREE.Vector2(23.8, 5),
      new THREE.Vector2(21.6, 3),
      new THREE.Vector2(20.5, -2),
    ]`
if (!t.includes(potOld)) throw new Error('anchor4 (pot profile)')
t = t.replace(potOld, potNew)
const soilOld = 'new THREE.CylinderGeometry(28.5, 26, 5, 40),'
if (!t.includes(soilOld)) throw new Error('anchor5 (soil)')
t = t.replace(soilOld, 'new THREE.CylinderGeometry(20, 18, 5, 40),')
const stemOld = `  const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(2.6, 3.4, 9, 12),
      new THREE.MeshStandardMaterial({ color: 0x6b7d4f, roughness: 0.95 }),
    )
    stem.position.y = SOIL_Y + 5`
const stemNew = `  const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(3.4, 4.6, 4, 12),
      new THREE.MeshStandardMaterial({ color: 0x6b7d4f, roughness: 0.95 }),
    )
    stem.position.y = SOIL_Y + 3
    stem.receiveShadow = true`
if (!t.includes(stemOld)) throw new Error('anchor6 (stem)')
t = t.replace(stemOld, stemNew)
const a7 = '    stemTop = SOIL_Y + 9'
let a7alt = '  const stemTop = SOIL_Y + 9'
if (t.includes(a7)) t = t.replace(a7, '    stemTop = SOIL_Y + 5')
else if (t.includes(a7alt)) t = t.replace(a7alt, '  const stemTop = SOIL_Y + 5')
else throw new Error('anchor7 (stemTop)')
const a8 = '      const mesh = new THREE.Mesh(this.leafGeometry!, this.material)'
if (!t.includes(a8)) throw new Error('anchor8 (leaf mesh)')
t = t.replace(a8, a8 + '\n      mesh.castShadow = true\n      mesh.receiveShadow = true')
const a9 = "    const pot = new THREE.Mesh(new THREE.LatheGeometry(profile, 48), terracotta)"
if (!t.includes(a9)) throw new Error('anchor9 (pot mesh)')
t = t.replace(a9, a9 + '\n    pot.receiveShadow = true')
const a10 = '    soil.position.y = SOIL_Y + 1'
if (!t.includes(a10)) throw new Error('anchor10 (soil pos)')
t = t.replace(a10, '    soil.position.y = SOIL_Y + 1\n    soil.receiveShadow = true')
// 粉霜混白减半
const a11 = '    const f = material.farina * 0.55'
if (!t.includes(a11)) throw new Error('anchor11 (farina)')
t = t.replace(a11, '    const f = material.farina * 0.3')
const a12 = '    this.material.sheen = 0.15 + 0.5 * material.farina'
if (!t.includes(a12)) throw new Error('anchor12 (sheen)')
t = t.replace(a12, '    this.material.sheen = 0.1 + 0.25 * material.farina')
writeFileSync('packages/render/src/plant.ts', t)

// —— 4. 场景：阴影贴图 + 光比 ——
let r = readFileSync('packages/render/src/index.ts', 'utf8')
const a13 = 'renderer.toneMappingExposure = 1.05'
if (!r.includes(a13)) throw new Error('anchor13')
r = r.replace(a13, a13 + '\n  renderer.shadowMap.enabled = true\n  renderer.shadowMap.type = THREE.PCFSoftShadowMap')
const a14 = "  const key = new THREE.DirectionalLight(0xfff4e6, 1.5) // M2：2.4→1.5（过曝是发白元凶）"
if (!r.includes(a14)) throw new Error('anchor14 (key)')
r = r.replace(a14, `  const key = new THREE.DirectionalLight(0xfff4e6, 1.8) // 光比拉开：朝向可读
  key.castShadow = true
  key.shadow.mapSize.set(1024, 1024)
  key.shadow.camera.left = -90
  key.shadow.camera.right = 90
  key.shadow.camera.top = 90
  key.shadow.camera.bottom = -90
  key.shadow.camera.near = 50
  key.shadow.camera.far = 500`)
const a15 = 'scene.environmentIntensity = 0.45'
if (!r.includes(a15)) throw new Error('anchor15 (env)')
r = r.replace(a15, 'scene.environmentIntensity = 0.35')
const a16 = 'scene.add(new THREE.AmbientLight(0xffffff, 0.3))'
if (!r.includes(a16)) throw new Error('anchor16 (ambient)')
r = r.replace(a16, 'scene.add(new THREE.AmbientLight(0xffffff, 0.18))')
writeFileSync('packages/render/src/index.ts', r)

// —— 5. 叶材质：透光稍强 ——
let lm = readFileSync('packages/render/src/leaf-material.ts', 'utf8')
const a17 = 'uTranslucency * 2.2'
if (!lm.includes(a17)) throw new Error('anchor17 (translucency)')
lm = lm.replace(a17, 'uTranslucency * 2.6')
writeFileSync('packages/render/src/leaf-material.ts', lm)

console.log('ALL 17 EDITS APPLIED')
