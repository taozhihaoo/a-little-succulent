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
}


/** 给已有 MeshPhysicalMaterial 注入叶片 shader（联系表等可复用） */
export function applyLeafShader(material: THREE.MeshPhysicalMaterial): LeafMaterialUniforms {
  const uniforms: LeafMaterialUniforms = {
    uKeyDir: { value: new THREE.Vector3(0, 1, 0) },
    uKeyColor: { value: new THREE.Color(0xffffff) },
    uStressColor: { value: new THREE.Color(0xd46a7a) },
    uStressAmount: { value: 0 },
    uTranslucency: { value: 0.55 },
  }

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uKeyDir = uniforms.uKeyDir
    shader.uniforms.uKeyColor = uniforms.uKeyColor
    shader.uniforms.uStressColor = uniforms.uStressColor
    shader.uniforms.uStressAmount = uniforms.uStressAmount
    shader.uniforms.uTranslucency = uniforms.uTranslucency

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float aT;\nattribute float aC;\nvarying float vT;\nvarying float vC;',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvT = aT;\nvC = aC;',
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
        ].join('\n'),
      )
      .replace(
        '#include <color_fragment>',
        [
          '#include <color_fragment>',
          'float stressMask = uStressAmount * pow(vT, 2.2) * (0.25 + 0.75 * vC);',
          'diffuseColor.rgb = mix(diffuseColor.rgb, uStressColor, clamp(stressMask, 0.0, 0.6));',
        ].join('\n'),
      )
      .replace(
        '#include <dithering_fragment>',
        [
          'float backlight = pow(clamp(dot(normalize(vViewPosition), -uKeyDir), 0.0, 1.0), 3.0);',
          'float thickness = mix(1.0, 0.25, vT);',
          'vec3 transmitted = uKeyColor * diffuseColor.rgb * backlight * thickness * uTranslucency * 2.6;',
          'gl_FragColor.rgb += transmitted * (0.5 + 0.5 * vC);',
          '#include <dithering_fragment>',
        ].join('\n'),
      )
  }

  // 每帧把主光方向换到视图空间（背光项使用）
  material.onBeforeRender = (_renderer, _scene, camera) => {
    uniforms.uKeyDir.value.copy(sunState.dir).transformDirection(camera.matrixWorldInverse)
    uniforms.uKeyColor.value.copy(sunState.color)
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
