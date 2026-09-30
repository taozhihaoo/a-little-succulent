/** 主光方向（世界空间）——SceneRoot.setDayPhase 写入，叶片背光 shader 读取 */
import * as THREE from 'three'

export const sunState = {
  dir: new THREE.Vector3(0.55, 0.75, 0.62).normalize(),
  /** 主光颜色（昼夜三段渐变：夜冷蓝紫 → 晨昏暖橙 → 白昼暖白） */
  color: new THREE.Color(1, 0.97, 0.9),
  /** leaf rim tint (day-night 3-segment) */
  tint: new THREE.Color(1, 1, 1),
}
