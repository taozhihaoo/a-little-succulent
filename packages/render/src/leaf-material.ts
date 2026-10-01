/**
 * 叶片材质（M2，04 §10）：MeshPhysicalMaterial + onBeforeCompile 注入。
 * 三个视觉目标：
 *  1. 伪 SSS 背光透光——视线逆着主光时，叶片按厚度（aT 基部厚）叠加透光色（晶莹感核心）
 *  2. 应激色渐变——沿 aT（基→尖）+ aC（中肋→缘）着色，替代全局平涂（04 §7）
 *  3. 粉霜——CPU 侧基色提亮去饱和 + sheen（PlantRenderer 负责）
 * 禁用真 transmission：透明窗口后是用户桌面，场景内折射无意义（总方案 §38.2）。
 */
import * as THREE from 'three'
import { sunState } from './sun'

export interface LeafMaterialUniforms {
  /** 主光方向（视图空间，由 onBeforeRender 每帧更新） */
  uKeyDir: { value: THREE.Vector3 }
  /** 主光颜色（线性空间） */
  uKeyColor: { value: THREE.Color }
  /** 应激色 0~1 RGB */
  uStressColor: { value: THREE.Color }
  /** 全株应激色强度 0~1 */
  uStressAmount: { value: number }
  /** 背光透光强度 0~1 */
  uTranslucency: { value: number }
  uSparkle: { value: number }
  uLightTint: { value: THREE.Color }
  uTime: { value: number }
  /** 锦化表达量 0~1（M6-2：奶油条纹强度） */
  uVariegata: { value: number }
}


/** 给已有 MeshPhysicalMaterial 注入叶片 shader（联系表等可复用） */
export function applyLeafShader(material: THREE.MeshPhysicalMaterial): LeafMaterialUniforms {
  const uniforms: LeafMaterialUniforms = {
    uKeyDir: { value: new THREE.Vector3(0, 1, 0) },
    uKeyColor: { value: new THREE.Color(0xffffff) },
    uStressColor: { value: new THREE.Color(0xd46a7a) },
    uStressAmount: { value: 0 },
    uTranslucency: { value: 0.55 },
    uSparkle: { value: 1 },
    uLightTint: { value: new THREE.Color(1, 1, 1) },
    uTime: { value: 0 },
    uVariegata: { value: 0 },
  }

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uKeyDir = uniforms.uKeyDir
    shader.uniforms.uKeyColor = uniforms.uKeyColor
    shader.uniforms.uStressColor = uniforms.uStressColor
    shader.uniforms.uStressAmount = uniforms.uStressAmount
    shader.uniforms.uTranslucency = uniforms.uTranslucency
    shader.uniforms.uSparkle = uniforms.uSparkle
    shader.uniforms.uLightTint = uniforms.uLightTint
    shader.uniforms.uTime = uniforms.uTime
    shader.uniforms.uVariegata = uniforms.uVariegata

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float aT;\nattribute float aC;\nvarying float vT;\n\nvarying vec3 vWPos;varying float vC;',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvT = aT;\n\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;vC = aC;',
      )

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        [
          '#include <common>',
          'uniform vec3 uStressColor;',
          'uniform float uStressAmount;',
          'uniform vec3 uKeyDir;',
          'uniform vec3 uKeyColor;',
          'uniform float uTranslucency;',
          'varying float vT;',
          'varying float vC;',
          'varying vec3 vWPos;',
          'uniform float uTime;',
          'uniform float uSparkle;',
          'uniform vec3 uLightTint;',
          'uniform float uVariegata;',
        ].join('\n'),
      )
      .replace(
        '#include <color_fragment>',
        [
          '#include <color_fragment>',
          'float stressMask = uStressAmount * pow(vT, 2.2) * (0.25 + 0.75 * vC);',
          'diffuseColor.rgb = mix(diffuseColor.rgb, uStressColor, clamp(stressMask, 0.0, 0.6));',
          // 锦化（M6-2）：沿叶长的奶油条纹 + 株内相位错开（真实锦斑的不规则分带）
          'if (uVariegata > 0.001) {',
          '  float band = 0.5 + 0.5 * sin(vT * 16.0 + vC * 4.0);',
          '  float phase = 0.5 + 0.5 * sin(vWPos.x * 1.1 + vWPos.z * 1.4);',
          '  float bandMask = smoothstep(0.42, 0.78, band * 0.6 + phase * 0.4) * uVariegata;',
          '  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.90, 0.78), clamp(bandMask, 0.0, 0.88));',
          '}',
        ].join('\n'),
      )
      .replace(
        '#include <dithering_fragment>',
        [
          'vec3 vNrm = normalize(vNormal);',
          'vec3 keyDirN = normalize(uKeyDir);',
          'float glintCell = fract(sin(dot(floor(vWPos.xz * 2.5 + vWPos.y * 1.7), vec2(127.1, 311.7))) * 43758.5453);',
          'float twinkle = 0.5 + 0.5 * sin(uTime * 0.0015 + glintCell * 6.2832);',
          'float faceKey = pow(clamp(dot(vNrm, keyDirN), 0.0, 1.0), 6.0);',
          'float glint = step(0.9, glintCell) * twinkle * faceKey * uSparkle;',
          'gl_FragColor.rgb += glint * 0.22 * vec3(1.0, 0.98, 0.92);',
          'float fres = pow(1.0 - clamp(abs(dot(vNrm, normalize(vViewPosition))), 0.0, 1.0), 2.5);',
          'gl_FragColor.rgb += uLightTint * fres * 0.4;',
          'float backlight = pow(clamp(dot(normalize(vViewPosition), -uKeyDir), 0.0, 1.0), 3.0);',
          'float thickness = mix(1.0, 0.25, vT);',
          'float breathe = 0.78 + 0.22 * sin(uTime * 0.0015708);',
          'vec3 transmitted = uKeyColor * diffuseColor.rgb * backlight * thickness * uTranslucency * breathe * 2.6;',
          'gl_FragColor.rgb += transmitted * (0.5 + 0.5 * vC);',
          '#include <dithering_fragment>',
        ].join('\n'),
      )
  }

  // 每帧把主光方向换到视图空间（背光项使用）
  material.onBeforeRender = (_renderer, _scene, camera) => {
    uniforms.uKeyDir.value.copy(sunState.dir).transformDirection(camera.matrixWorldInverse)
    uniforms.uKeyColor.value.copy(sunState.color)
    uniforms.uLightTint.value.copy(sunState.tint)
    uniforms.uTime.value = performance.now() % 4000
  }

  return uniforms
}

export function createLeafMaterial(): {
  material: THREE.MeshPhysicalMaterial
  uniforms: LeafMaterialUniforms
} {
  const material = new THREE.MeshPhysicalMaterial({
    color: 0x7da87b,
    roughness: 0.55,
    sheen: 0.5,
    sheenRoughness: 0.8,
    sheenColor: new THREE.Color(0xffffff),
    clearcoat: 0.25,
    clearcoatRoughness: 0.5,
  })
  const uniforms = applyLeafShader(material)
  return { material, uniforms }
}
